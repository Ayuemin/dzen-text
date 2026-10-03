package io.github.ayuemin.texteditor;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.BreakIterator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

/**
 * Optional, fully local semantic classifier.
 *
 * A model can be bundled in assets or installed by the user as a ZIP package.
 * User packages live only in app-private storage. The package must contain an
 * ONNX model (model.onnx or local_text_classifier.onnx) and metadata JSON
 * (metadata.json or local_text_classifier.json).
 */
final class LocalTextClassifier implements AutoCloseable {
    static final String MODEL_ASSET = "models/local_text_classifier.onnx";
    static final String META_ASSET = "models/local_text_classifier.json";
    private static final String USER_DIR = "local_classifier";
    private static final String USER_MODEL = "model.onnx";
    private static final String USER_META = "metadata.json";
    private static final String PREFS = "editor_text";
    private static final String PREF_PACKAGE_NAME = "local_classifier_package_name";
    private static final String SCHEMA = "local-text-classifier-v1";
    private static final String FEATURE_KIND = "char-ngram-hash-v1";
    private static final int MAX_SEGMENTS = 512;
    private static final long MAX_MODEL_BYTES = 512L * 1024L * 1024L;
    private static final long MAX_META_BYTES = 2L * 1024L * 1024L;

    private final Context context;
    private OrtEnvironment environment;
    private OrtSession session;
    private Metadata metadata;
    private boolean loadAttempted;
    private String lastError = "";
    private String activeSource = "";

    LocalTextClassifier(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized String statusJson() {
        ensureLoaded();
        JSONObject out = new JSONObject();
        try {
            boolean userModel = userModelFile().exists();
            boolean userMeta = userMetaFile().exists();
            boolean bundled = assetExists(MODEL_ASSET) && assetExists(META_ASSET);
            out.put("engine", "ONNX Runtime");
            out.put("installed", (userModel && userMeta) || bundled);
            out.put("userInstalled", userModel && userMeta);
            out.put("available", session != null && metadata != null);
            out.put("source", activeSource);
            if (userModel != userMeta) out.put("incompleteUserPackage", true);
            if ("user".equals(activeSource)) {
                out.put("packageName", context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        .getString(PREF_PACKAGE_NAME, "Локальная модель"));
            }
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

            String inputName = resolvedInputName(session, metadata);
            try (OnnxTensor input = OnnxTensor.createTensor(environment, features);
                 OrtSession.Result result = session.run(Collections.singletonMap(inputName, input))) {
                OnnxValue value = resolvedOutput(result, metadata);
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

    /** Installs and validates a user model package without touching a working model on failure. */
    synchronized String installPackage(InputStream input, String displayName) throws Exception {
        if (input == null) throw new IllegalArgumentException("Файл модели не открыт");
        File dir = userDirectory();
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Не удалось создать папку модели");
        File newModel = new File(dir, USER_MODEL + ".new");
        File newMeta = new File(dir, USER_META + ".new");
        deleteQuietly(newModel);
        deleteQuietly(newMeta);

        boolean gotModel = false;
        boolean gotMeta = false;
        try (ZipInputStream zip = new ZipInputStream(input)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    zip.closeEntry();
                    continue;
                }
                String base = baseName(entry.getName()).toLowerCase(Locale.ROOT);
                if (("model.onnx".equals(base) || "local_text_classifier.onnx".equals(base)) && !gotModel) {
                    copyEntryLimited(zip, newModel, MAX_MODEL_BYTES);
                    gotModel = true;
                } else if (("metadata.json".equals(base) || "local_text_classifier.json".equals(base)) && !gotMeta) {
                    copyEntryLimited(zip, newMeta, MAX_META_BYTES);
                    gotMeta = true;
                }
                zip.closeEntry();
            }
        } catch (Exception e) {
            deleteQuietly(newModel);
            deleteQuietly(newMeta);
            throw e;
        }
        if (!gotModel || !gotMeta || newModel.length() < 128 || newMeta.length() < 20) {
            deleteQuietly(newModel);
            deleteQuietly(newMeta);
            throw new IllegalArgumentException("В ZIP нужны model.onnx и metadata.json");
        }

        Metadata candidateMeta = Metadata.parse(readFileText(newMeta));
        validateModelFile(newModel, candidateMeta);

        File model = userModelFile();
        File meta = userMetaFile();
        File oldModel = new File(dir, USER_MODEL + ".bak");
        File oldMeta = new File(dir, USER_META + ".bak");
        deleteQuietly(oldModel);
        deleteQuietly(oldMeta);
        boolean hadModel = model.exists();
        boolean hadMeta = meta.exists();
        if (hadModel && !model.renameTo(oldModel)) throw new IllegalStateException("Не удалось подготовить замену модели");
        if (hadMeta && !meta.renameTo(oldMeta)) {
            if (hadModel) oldModel.renameTo(model);
            throw new IllegalStateException("Не удалось подготовить замену метаданных");
        }

        closeSession();
        metadata = null;
        loadAttempted = false;
        activeSource = "";
        boolean modelMoved = newModel.renameTo(model);
        boolean metaMoved = newMeta.renameTo(meta);
        if (!modelMoved || !metaMoved) {
            deleteQuietly(model);
            deleteQuietly(meta);
            if (hadModel) oldModel.renameTo(model);
            if (hadMeta) oldMeta.renameTo(meta);
            deleteQuietly(newModel);
            deleteQuietly(newMeta);
            throw new IllegalStateException("Не удалось сохранить модель во внутреннее хранилище");
        }
        deleteQuietly(oldModel);
        deleteQuietly(oldMeta);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(PREF_PACKAGE_NAME, displayName == null || displayName.trim().isEmpty()
                        ? "Локальная модель" : displayName.trim())
                .apply();

        if (!ensureLoaded() || !"user".equals(activeSource)) {
            String problem = lastError.isEmpty() ? "Модель не загрузилась после установки" : lastError;
            throw new IllegalStateException(problem);
        }
        return statusJson();
    }

    synchronized boolean clearUserModel() {
        closeSession();
        metadata = null;
        loadAttempted = false;
        activeSource = "";
        boolean okModel = !userModelFile().exists() || userModelFile().delete();
        boolean okMeta = !userMetaFile().exists() || userMetaFile().delete();
        File dir = userDirectory();
        deleteQuietly(new File(dir, USER_MODEL + ".new"));
        deleteQuietly(new File(dir, USER_META + ".new"));
        deleteQuietly(new File(dir, USER_MODEL + ".bak"));
        deleteQuietly(new File(dir, USER_META + ".bak"));
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PREF_PACKAGE_NAME).apply();
        lastError = "";
        ensureLoaded(); // fall back to a bundled model when one exists
        return okModel && okMeta;
    }

    private synchronized boolean ensureLoaded() {
        if (session != null && metadata != null) return true;
        if (loadAttempted) return false;
        loadAttempted = true;
        String userError = "";

        if (userModelFile().exists() && userMetaFile().exists()) {
            try {
                metadata = Metadata.parse(readFileText(userMetaFile()));
                environment = OrtEnvironment.getEnvironment();
                session = environment.createSession(userModelFile().getAbsolutePath());
                validateSession(session, metadata);
                activeSource = "user";
                lastError = "";
                return true;
            } catch (Exception e) {
                userError = safeError(e);
                closeSession();
                metadata = null;
                activeSource = "";
            }
        } else if (userModelFile().exists() || userMetaFile().exists()) {
            userError = "Пользовательский пакет модели неполный";
        }

        if (assetExists(MODEL_ASSET) && assetExists(META_ASSET)) {
            try {
                metadata = Metadata.parse(readAssetText(META_ASSET));
                byte[] model = readAssetBytes(MODEL_ASSET);
                environment = OrtEnvironment.getEnvironment();
                session = environment.createSession(model);
                validateSession(session, metadata);
                activeSource = "bundled";
                lastError = userError;
                return true;
            } catch (Exception e) {
                closeSession();
                metadata = null;
                activeSource = "";
                lastError = userError.isEmpty() ? safeError(e) : userError + "; встроенная: " + safeError(e);
                return false;
            }
        }
        lastError = userError;
        return false;
    }

    private void validateModelFile(File modelFile, Metadata meta) throws Exception {
        OrtEnvironment env = OrtEnvironment.getEnvironment();
        try (OrtSession candidate = env.createSession(modelFile.getAbsolutePath())) {
            validateSession(candidate, meta);
            float[][] sample = new float[1][meta.featureCount];
            String inputName = resolvedInputName(candidate, meta);
            try (OnnxTensor tensor = OnnxTensor.createTensor(env, sample);
                 OrtSession.Result result = candidate.run(Collections.singletonMap(inputName, tensor))) {
                OnnxValue value = resolvedOutput(result, meta);
                float[][] rows = asRows(value.getValue(), 1);
                if (rows.length != 1 || rows[0].length < meta.labels.size()) {
                    throw new IllegalArgumentException("Выход модели не соответствует labels в metadata.json");
                }
            }
        }
    }

    private static void validateSession(OrtSession target, Metadata meta) {
        if (target.getNumInputs() < 1 || target.getNumOutputs() < 1) {
            throw new IllegalArgumentException("ONNX-модель не содержит вход или выход");
        }
        if (!meta.inputName.isEmpty() && !target.getInputNames().contains(meta.inputName)) {
            throw new IllegalArgumentException("В модели нет входа «" + meta.inputName + "»");
        }
        if (!meta.outputName.isEmpty() && !target.getOutputNames().contains(meta.outputName)) {
            throw new IllegalArgumentException("В модели нет выхода «" + meta.outputName + "»");
        }
    }

    private static String resolvedInputName(OrtSession target, Metadata meta) {
        return meta.inputName.isEmpty() ? target.getInputNames().iterator().next() : meta.inputName;
    }

    private static OnnxValue resolvedOutput(OrtSession.Result result, Metadata meta) {
        if (!meta.outputName.isEmpty() && result.get(meta.outputName).isPresent()) {
            return result.get(meta.outputName).get();
        }
        return result.get(0);
    }

    private File userDirectory() {
        return new File(context.getFilesDir(), USER_DIR);
    }

    private File userModelFile() {
        return new File(userDirectory(), USER_MODEL);
    }

    private File userMetaFile() {
        return new File(userDirectory(), USER_META);
    }

    private boolean assetExists(String name) {
        try (InputStream ignored = context.getAssets().open(name)) {
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private String readAssetText(String name) throws Exception {
        return new String(readAssetBytes(name), StandardCharsets.UTF_8);
    }

    private byte[] readAssetBytes(String name) throws Exception {
        try (InputStream in = context.getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toByteArray();
        }
    }

    private static String readFileText(File file) throws Exception {
        try (FileInputStream in = new FileInputStream(file);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static String baseName(String path) {
        if (path == null) return "";
        int slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    private static void copyEntryLimited(InputStream in, File target, long maxBytes) throws Exception {
        try (FileOutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[16384];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) throw new IllegalArgumentException("Файл модели слишком большой");
                out.write(buffer, 0, read);
            }
            out.flush();
        }
    }

    private static void deleteQuietly(File file) {
        try { if (file != null && file.exists()) file.delete(); } catch (Exception ignored) { }
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
        String normalized = text.toLowerCase(new Locale("ru", "RU"))
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
        activeSource = "";
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
