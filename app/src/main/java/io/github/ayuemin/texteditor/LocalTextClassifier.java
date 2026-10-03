package io.github.ayuemin.texteditor;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.BreakIterator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

/**
 * Optional, fully local semantic classifier.
 *
 * The editor works normally when the model is absent. To enable this layer put
 * models/local_text_classifier.onnx and models/local_text_classifier.json into
 * app/src/main/assets. The metadata describes a compact hashed character
 * n-gram input, so no separate tokenizer library is required on Android.
 */
final class LocalTextClassifier implements AutoCloseable {
    static final String MODEL_ASSET = "models/local_text_classifier.onnx";
    static final String META_ASSET = "models/local_text_classifier.json";
    private static final String SCHEMA = "local-text-classifier-v1";
    private static final String FEATURE_KIND = "char-ngram-hash-v1";
    private static final int MAX_SEGMENTS = 512;

    private final Context context;
    private OrtEnvironment environment;
    private OrtSession session;
    private Metadata metadata;
    private boolean loadAttempted;
    private String lastError = "";

    LocalTextClassifier(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized String statusJson() {
        ensureLoaded();
        JSONObject out = new JSONObject();
        try {
            boolean modelPresent = assetExists(MODEL_ASSET);
            boolean metaPresent = assetExists(META_ASSET);
            out.put("engine", "ONNX Runtime");
            out.put("installed", modelPresent && metaPresent);
            out.put("available", session != null && metadata != null);
            if (metadata != null) {
                out.put("name", metadata.name);
                out.put("version", metadata.version);
                out.put("labels", metadata.labels.size());
                out.put("features", metadata.featureCount);
            }
            if (!lastError.isEmpty()) out.put("error", lastError);
        } catch (Exception ignored) { }
        return out.toString();
    }

    synchronized String analyzeJson(String source) {
        JSONArray issues = new JSONArray();
        JSONObject out = new JSONObject();
        try {
            if (!ensureLoaded()) {
                out.put("available", false);
                out.put("issues", issues);
                if (!lastError.isEmpty()) out.put("error", lastError);
                return out.toString();
            }

            String src = source == null ? "" : source;
            List<Segment> segments = splitSentences(src);
            out.put("available", true);
            out.put("segments", segments.size());
            if (segments.isEmpty()) {
                out.put("issues", issues);
                return out.toString();
            }

            float[][] features = new float[segments.size()][metadata.featureCount];
            for (int i = 0; i < segments.size(); i++) {
                features[i] = featuresFor(segments.get(i).text, metadata);
            }

            String inputName = metadata.inputName.isEmpty()
                    ? session.getInputNames().iterator().next() : metadata.inputName;
            try (OnnxTensor input = OnnxTensor.createTensor(environment, features);
                 OrtSession.Result result = session.run(Collections.singletonMap(inputName, input))) {
                OnnxValue value;
                if (!metadata.outputName.isEmpty() && result.get(metadata.outputName).isPresent()) {
                    value = result.get(metadata.outputName).get();
                } else {
                    value = result.get(0);
                }
                float[][] scores = asRows(value.getValue(), segments.size());
                if (scores.length != segments.size()) {
                    throw new IllegalStateException("Размер выхода модели не совпадает с числом предложений");
                }

                int emitted = 0;
                for (int row = 0; row < scores.length && emitted < 120; row++) {
                    float[] probabilities = activate(scores[row], metadata.activation);
                    int labelCount = Math.min(probabilities.length, metadata.labels.size());
                    for (int col = 0; col < labelCount && emitted < 120; col++) {
                        Label label = metadata.labels.get(col);
                        float score = probabilities[col];
                        if (!label.emit || score < label.threshold) continue;
                        Segment segment = segments.get(row);
                        JSONObject issue = new JSONObject();
                        issue.put("id", label.id);
                        issue.put("title", label.title);
                        issue.put("message", label.message);
                        issue.put("start", segment.start);
                        issue.put("end", segment.end);
                        issue.put("score", Math.round(score * 1000f) / 1000.0);
                        issue.put("severity", label.severity);
                        issues.put(issue);
                        emitted++;
                    }
                }
            }
            lastError = "";
            out.put("issues", issues);
            return out.toString();
        } catch (Exception e) {
            lastError = safeError(e);
            try {
                out.put("available", false);
                out.put("issues", issues);
                out.put("error", lastError);
            } catch (Exception ignored) { }
            return out.toString();
        }
    }

    private synchronized boolean ensureLoaded() {
        if (session != null && metadata != null) return true;
        if (loadAttempted) return false;
        loadAttempted = true;
        if (!assetExists(MODEL_ASSET) || !assetExists(META_ASSET)) return false;
        try {
            metadata = Metadata.parse(readText(META_ASSET));
            byte[] model = readBytes(MODEL_ASSET);
            environment = OrtEnvironment.getEnvironment();
            session = environment.createSession(model);
            if (session.getNumInputs() < 1 || session.getNumOutputs() < 1) {
                throw new IllegalArgumentException("ONNX-модель не содержит вход или выход");
            }
            lastError = "";
            return true;
        } catch (Exception e) {
            lastError = safeError(e);
            closeSession();
            metadata = null;
            return false;
        }
    }

    private boolean assetExists(String name) {
        try (InputStream ignored = context.getAssets().open(name)) {
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String readText(String name) throws Exception {
        return new String(readBytes(name), StandardCharsets.UTF_8);
    }

    private byte[] readBytes(String name) throws Exception {
        try (InputStream in = context.getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toByteArray();
        }
    }

    private static List<Segment> splitSentences(String src) {
        List<Segment> out = new ArrayList<>();
        BreakIterator iterator = BreakIterator.getSentenceInstance(new Locale("ru", "RU"));
        iterator.setText(src);
        int start = iterator.first();
        for (int end = iterator.next(); end != BreakIterator.DONE && out.size() < MAX_SEGMENTS;
             start = end, end = iterator.next()) {
            int a = start;
            int b = end;
            while (a < b && Character.isWhitespace(src.charAt(a))) a++;
            while (b > a && Character.isWhitespace(src.charAt(b - 1))) b--;
            if (b - a < 3) continue;
            String text = src.substring(a, b);
            if (text.trim().isEmpty()) continue;
            out.add(new Segment(a, b, text));
        }
        return out;
    }

    private static float[] featuresFor(String text, Metadata meta) {
        float[] vector = new float[meta.featureCount];
        String normalized = text.toLocaleLowerCase(new Locale("ru", "RU"))
                .replaceAll("\\s+", " ").trim();
        if (normalized.isEmpty()) return vector;
        String padded = " " + normalized + " ";
        for (int n = meta.ngramMin; n <= meta.ngramMax; n++) {
            if (padded.length() < n) continue;
            for (int i = 0; i + n <= padded.length(); i++) {
                int hash = fnv1a(padded, i, i + n);
                int index = (hash & 0x7fffffff) % vector.length;
                vector[index] += hash < 0 ? -1f : 1f;
            }
        }
        float sum = 0f;
        for (float v : vector) sum += v * v;
        if (sum > 0f) {
            float norm = (float) Math.sqrt(sum);
            for (int i = 0; i < vector.length; i++) vector[i] /= norm;
        }
        return vector;
    }

    private static int fnv1a(String value, int start, int end) {
        int hash = 0x811c9dc5;
        for (int i = start; i < end; i++) {
            char c = value.charAt(i);
            hash ^= c & 0xff;
            hash *= 0x01000193;
            hash ^= (c >>> 8) & 0xff;
            hash *= 0x01000193;
        }
        return hash;
    }

    private static float[][] asRows(Object value, int expectedRows) {
        if (value instanceof float[][]) return (float[][]) value;
        if (value instanceof float[]) {
            float[] row = (float[]) value;
            if (expectedRows == 1) return new float[][]{row};
        }
        throw new IllegalArgumentException("Ожидался FLOAT-выход формы [N, labels]");
    }

    private static float[] activate(float[] values, String activation) {
        float[] out = values.clone();
        if ("none".equals(activation)) return out;
        if ("softmax".equals(activation)) {
            float max = -Float.MAX_VALUE;
            for (float value : out) if (value > max) max = value;
            double sum = 0d;
            for (int i = 0; i < out.length; i++) {
                out[i] = (float) Math.exp(out[i] - max);
                sum += out[i];
            }
            if (sum > 0d) for (int i = 0; i < out.length; i++) out[i] /= (float) sum;
            return out;
        }
        for (int i = 0; i < out.length; i++) {
            out[i] = (float) (1d / (1d + Math.exp(-out[i])));
        }
        return out;
    }

    private static String safeError(Exception e) {
        String message = e.getMessage();
        if (message == null || message.trim().isEmpty()) message = e.getClass().getSimpleName();
        if (message.length() > 220) message = message.substring(0, 220);
        return message;
    }

    private void closeSession() {
        if (session != null) {
            try { session.close(); } catch (Exception ignored) { }
            session = null;
        }
    }

    @Override
    public synchronized void close() {
        closeSession();
        metadata = null;
    }

    private static final class Segment {
        final int start;
        final int end;
        final String text;
        Segment(int start, int end, String text) {
            this.start = start;
            this.end = end;
            this.text = text;
        }
    }

    private static final class Label {
        final String id;
        final String title;
        final String message;
        final String severity;
        final float threshold;
        final boolean emit;

        Label(String id, String title, String message, String severity, float threshold, boolean emit) {
            this.id = id;
            this.title = title;
            this.message = message;
            this.severity = severity;
            this.threshold = threshold;
            this.emit = emit;
        }
    }

    private static final class Metadata {
        final String name;
        final String version;
        final String inputName;
        final String outputName;
        final String activation;
        final int featureCount;
        final int ngramMin;
        final int ngramMax;
        final List<Label> labels;

        Metadata(String name, String version, String inputName, String outputName,
                 String activation, int featureCount, int ngramMin, int ngramMax, List<Label> labels) {
            this.name = name;
            this.version = version;
            this.inputName = inputName;
            this.outputName = outputName;
            this.activation = activation;
            this.featureCount = featureCount;
            this.ngramMin = ngramMin;
            this.ngramMax = ngramMax;
            this.labels = labels;
        }

        static Metadata parse(String raw) throws Exception {
            JSONObject json = new JSONObject(raw);
            if (!SCHEMA.equals(json.optString("schema"))) {
                throw new IllegalArgumentException("Неверная schema метаданных модели");
            }
            if (!FEATURE_KIND.equals(json.optString("feature_kind"))) {
                throw new IllegalArgumentException("Неподдерживаемый feature_kind модели");
            }
            int featureCount = json.optInt("feature_count", 4096);
            int ngramMin = json.optInt("ngram_min", 3);
            int ngramMax = json.optInt("ngram_max", 5);
            if (featureCount < 128 || featureCount > 131072) {
                throw new IllegalArgumentException("feature_count вне допустимого диапазона");
            }
            if (ngramMin < 1 || ngramMax < ngramMin || ngramMax > 8) {
                throw new IllegalArgumentException("Некорректный диапазон n-грамм");
            }
            String activation = json.optString("activation", "sigmoid").toLowerCase(Locale.ROOT);
            if (!("sigmoid".equals(activation) || "softmax".equals(activation) || "none".equals(activation))) {
                throw new IllegalArgumentException("activation должен быть sigmoid, softmax или none");
            }
            JSONArray sourceLabels = json.optJSONArray("labels");
            if (sourceLabels == null || sourceLabels.length() == 0) {
                throw new IllegalArgumentException("В метаданных нет labels");
            }
            List<Label> labels = new ArrayList<>();
            for (int i = 0; i < sourceLabels.length(); i++) {
                JSONObject label = sourceLabels.getJSONObject(i);
                String id = label.optString("id").trim();
                if (id.isEmpty()) throw new IllegalArgumentException("Пустой id метки модели");
                String title = label.optString("title", id).trim();
                String message = label.optString("message", "Проверьте смысл и контекст этого предложения.").trim();
                String severity = label.optString("severity", "warning").trim();
                float threshold = (float) label.optDouble("threshold", 0.72);
                if (!(threshold > 0f && threshold <= 1f)) {
                    throw new IllegalArgumentException("threshold должен быть > 0 и <= 1");
                }
                labels.add(new Label(id, title, message, severity, threshold, label.optBoolean("emit", true)));
            }
            return new Metadata(
                    json.optString("name", "Локальная смысловая модель"),
                    json.optString("version", "1"),
                    json.optString("input_name", ""),
                    json.optString("output_name", ""),
                    activation,
                    featureCount,
                    ngramMin,
                    ngramMax,
                    labels
            );
        }
    }
}
