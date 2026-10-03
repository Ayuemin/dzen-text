package io.github.ayuemin.texteditor;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.text.BreakIterator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

/**
 * Small local zero-shot classifier for semantic review.
 *
 * A model package contains model.onnx, vocab.txt and metadata.json. The package
 * is copied into app-private storage and the original downloaded ZIP is never
 * referenced again. Classification uses NLI: each article segment is compared
 * with short user-editable semantic category descriptions. No text generation
 * or model-authored JSON is involved.
 */
final class LocalNliEngine implements AutoCloseable {
    private static final String SCHEMA = "dzen-nli-model-v1";
    private static final String DIR = "local_nli";
    private static final String ACTIVE = "active";
    private static final String CANDIDATE = "candidate";
    private static final String BACKUP = "backup";
    private static final String MODEL = "model.onnx";
    private static final String VOCAB = "vocab.txt";
    private static final String META = "metadata.json";
    private static final long MAX_MODEL_BYTES = 700L * 1024L * 1024L;
    private static final long MAX_VOCAB_BYTES = 8L * 1024L * 1024L;
    private static final long MAX_META_BYTES = 512L * 1024L;
    private static final int MAX_CATEGORIES = 24;
    private static final int MAX_SEGMENTS = 280;
    private static final int MAX_SEGMENT_CHARS = 1200;
    private static final int BATCH_SIZE = 24;
    private static final int MAX_ISSUES = 180;

    private final Context appContext;
    private final File rootDir;
    private final File activeDir;
    private final File candidateDir;
    private final File backupDir;
    private final OrtEnvironment environment;

    private OrtSession session;
    private WordPieceTokenizer tokenizer;
    private ModelMeta meta;
    private String lastError = "";

    LocalNliEngine(Context context) {
        appContext = context.getApplicationContext();
        rootDir = new File(appContext.getFilesDir(), DIR);
        activeDir = new File(rootDir, ACTIVE);
        candidateDir = new File(rootDir, CANDIDATE);
        backupDir = new File(rootDir, BACKUP);
        environment = OrtEnvironment.getEnvironment();
    }

    synchronized String statusJson() {
        JSONObject out = new JSONObject();
        boolean installed = packageLooksPresent(activeDir);
        out.put("engine", "ONNX Runtime");
        out.put("kind", "NLI zero-shot classifier");
        out.put("installed", installed);
        out.put("available", installed);
        if (installed) {
            try {
                ModelMeta m = readMeta(new File(activeDir, META));
                out.put("name", m.name);
                out.put("version", m.version);
                out.put("source", m.source);
                out.put("sizeBytes", new File(activeDir, MODEL).length());
                out.put("maxLength", m.maxLength);
            } catch (Exception e) {
                out.put("available", false);
                out.put("error", safeMessage(e));
            }
        }
        if (!lastError.isEmpty() && !out.has("error")) out.put("error", lastError);
        return out.toString();
    }

    synchronized String installPackage(InputStream input, String displayName) throws Exception {
        if (!rootDir.exists() && !rootDir.mkdirs()) throw new IllegalStateException("Не удалось создать папку смысловой модели");
        closeLoaded();
        deleteTree(candidateDir);
        deleteTree(backupDir);
        if (!candidateDir.mkdirs()) throw new IllegalStateException("Не удалось подготовить установку модели");

        long modelBytes = 0L, vocabBytes = 0L, metaBytes = 0L;
        boolean gotModel = false, gotVocab = false, gotMeta = false;
        byte[] buffer = new byte[1024 * 1024];
        try (ZipInputStream zin = new ZipInputStream(input)) {
            ZipEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String base = new File(entry.getName()).getName();
                File target;
                long max;
                if (MODEL.equals(base)) { target = new File(candidateDir, MODEL); max = MAX_MODEL_BYTES; gotModel = true; }
                else if (VOCAB.equals(base)) { target = new File(candidateDir, VOCAB); max = MAX_VOCAB_BYTES; gotVocab = true; }
                else if (META.equals(base)) { target = new File(candidateDir, META); max = MAX_META_BYTES; gotMeta = true; }
                else continue;
                long total = 0L;
                try (FileOutputStream out = new FileOutputStream(target)) {
                    int n;
                    while ((n = zin.read(buffer)) >= 0) {
                        if (n == 0) continue;
                        total += n;
                        if (total > max) throw new IllegalArgumentException("Файл " + base + " слишком большой");
                        out.write(buffer, 0, n);
                    }
                    out.getFD().sync();
                }
                if (MODEL.equals(base)) modelBytes = total;
                else if (VOCAB.equals(base)) vocabBytes = total;
                else metaBytes = total;
            }
        }
        if (!gotModel || !gotVocab || !gotMeta) throw new IllegalArgumentException("В ZIP должны быть model.onnx, vocab.txt и metadata.json");
        if (modelBytes < 1024 * 1024 || vocabBytes < 1024 || metaBytes < 20) throw new IllegalArgumentException("Пакет модели повреждён или неполный");

        ModelMeta candidateMeta = readMeta(new File(candidateDir, META));
        WordPieceTokenizer candidateTokenizer = new WordPieceTokenizer(new File(candidateDir, VOCAB), candidateMeta.maxLength);
        validateModel(new File(candidateDir, MODEL), candidateMeta, candidateTokenizer);

        if (activeDir.exists() && !activeDir.renameTo(backupDir)) throw new IllegalStateException("Не удалось подготовить замену модели");
        if (!candidateDir.renameTo(activeDir)) {
            if (backupDir.exists()) backupDir.renameTo(activeDir);
            throw new IllegalStateException("Не удалось сохранить модель во внутреннее хранилище");
        }
        deleteTree(backupDir);
        lastError = "";
        return statusJson();
    }

    synchronized boolean clearModel() {
        closeLoaded();
        deleteTree(candidateDir);
        deleteTree(backupDir);
        boolean ok = deleteTree(activeDir);
        lastError = "";
        return ok;
    }

    synchronized String analyzeJson(String source, String categoriesJson) {
        JSONObject out = new JSONObject();
        JSONArray issues = new JSONArray();
        long started = System.currentTimeMillis();
        try {
            ensureLoaded();
            List<Category> categories = parseCategories(categoriesJson);
            if (categories.isEmpty()) {
                out.put("available", true);
                out.put("issues", issues);
                out.put("segments", 0);
                out.put("pairs", 0);
                out.put("elapsedMs", System.currentTimeMillis() - started);
                return out.toString();
            }
            List<Segment> allSegments = splitSegments(source == null ? "" : source);
            boolean truncated = allSegments.size() > MAX_SEGMENTS;
            List<Segment> segments = allSegments.size() > MAX_SEGMENTS ? allSegments.subList(0, MAX_SEGMENTS) : allSegments;
            List<PairWork> pairs = new ArrayList<>();
            for (Segment segment : segments) {
                for (Category category : categories) pairs.add(new PairWork(segment, category));
            }
            int runs = 0;
            Set<String> seen = new HashSet<>();
            for (int offset = 0; offset < pairs.size() && issues.length() < MAX_ISSUES; offset += BATCH_SIZE) {
                int end = Math.min(pairs.size(), offset + BATCH_SIZE);
                List<PairWork> batch = pairs.subList(offset, end);
                float[] scores = runBatch(batch);
                runs++;
                for (int i = 0; i < batch.size() && issues.length() < MAX_ISSUES; i++) {
                    PairWork work = batch.get(i);
                    float score = scores[i];
                    if (score < work.category.threshold) continue;
                    String key = work.segment.id + "\u0000" + work.category.id;
                    if (!seen.add(key)) continue;
                    JSONObject issue = new JSONObject();
                    issue.put("id", "nli-" + work.category.id);
                    issue.put("category", work.category.name);
                    issue.put("title", work.category.name);
                    issue.put("message", "Смысл фрагмента соответствует категории «" + work.category.name + "».");
                    issue.put("score", score);
                    issue.put("start", work.segment.start);
                    issue.put("end", work.segment.end);
                    issue.put("severity", "warning");
                    issues.put(issue);
                }
            }
            lastError = "";
            out.put("available", true);
            out.put("issues", issues);
            out.put("segments", segments.size());
            out.put("categories", categories.size());
            out.put("pairs", pairs.size());
            out.put("runs", runs);
            out.put("truncated", truncated);
            out.put("elapsedMs", System.currentTimeMillis() - started);
            out.put("modelName", meta.name);
            return out.toString();
        } catch (Throwable t) {
            lastError = safeMessage(t);
            out.put("available", false);
            out.put("issues", issues);
            out.put("error", lastError);
            out.put("elapsedMs", System.currentTimeMillis() - started);
            return out.toString();
        }
    }

    private void ensureLoaded() throws Exception {
        if (session != null && tokenizer != null && meta != null) return;
        if (!packageLooksPresent(activeDir)) throw new IllegalStateException("Смысловая модель не установлена");
        ModelMeta loadedMeta = readMeta(new File(activeDir, META));
        WordPieceTokenizer loadedTokenizer = new WordPieceTokenizer(new File(activeDir, VOCAB), loadedMeta.maxLength);
        OrtSession loadedSession = createSession(new File(activeDir, MODEL));
        validateSessionContract(loadedSession, loadedMeta);
        meta = loadedMeta;
        tokenizer = loadedTokenizer;
        session = loadedSession;
    }

    private OrtSession createSession(File model) throws OrtException {
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        options.setIntraOpNumThreads(Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors())));
        return environment.createSession(model.getAbsolutePath(), options);
    }

    private void validateModel(File model, ModelMeta candidateMeta, WordPieceTokenizer candidateTokenizer) throws Exception {
        try (OrtSession test = createSession(model)) {
            validateSessionContract(test, candidateMeta);
            EncodedPair encoded = candidateTokenizer.encodePair("Кошка сидит на ковре.", "В тексте говорится о кошке.");
            float[] score = runEncodedBatch(test, candidateMeta, Collections.singletonList(encoded));
            if (score.length != 1 || Float.isNaN(score[0])) throw new IllegalArgumentException("Модель не прошла тестовый запуск");
        }
    }

    private void validateSessionContract(OrtSession s, ModelMeta m) {
        Set<String> inputs = s.getInputNames();
        if (!inputs.contains("input_ids") || !inputs.contains("attention_mask") || !inputs.contains("token_type_ids")) {
            throw new IllegalArgumentException("ONNX-модель имеет несовместимые входы");
        }
        if (m.entailmentIndex < 0 || m.entailmentIndex > 8) throw new IllegalArgumentException("Некорректный entailment_index");
    }

    private float[] runBatch(List<PairWork> batch) throws Exception {
        List<EncodedPair> encoded = new ArrayList<>(batch.size());
        for (PairWork work : batch) encoded.add(tokenizer.encodePair(work.segment.text, work.category.description));
        return runEncodedBatch(session, meta, encoded);
    }

    private float[] runEncodedBatch(OrtSession s, ModelMeta m, List<EncodedPair> encoded) throws Exception {
        int batch = encoded.size();
        int seq = 2;
        for (EncodedPair e : encoded) seq = Math.max(seq, e.ids.length);
        long[] idsFlat = new long[batch * seq];
        long[] maskFlat = new long[batch * seq];
        long[] typeFlat = new long[batch * seq];
        for (int b = 0; b < batch; b++) {
            EncodedPair e = encoded.get(b);
            for (int j = 0; j < e.ids.length; j++) {
                int p = b * seq + j;
                idsFlat[p] = e.ids[j];
                maskFlat[p] = 1L;
                typeFlat[p] = e.types[j];
            }
        }
        long[] shape = new long[]{batch, seq};
        try (OnnxTensor ids = OnnxTensor.createTensor(environment, LongBuffer.wrap(idsFlat), shape);
             OnnxTensor mask = OnnxTensor.createTensor(environment, LongBuffer.wrap(maskFlat), shape);
             OnnxTensor types = OnnxTensor.createTensor(environment, LongBuffer.wrap(typeFlat), shape)) {
            Map<String, OnnxTensor> inputs = new HashMap<>();
            inputs.put("input_ids", ids);
            inputs.put("attention_mask", mask);
            inputs.put("token_type_ids", types);
            try (OrtSession.Result result = s.run(inputs)) {
                OnnxValue value = result.get(0);
                Object raw = value.getValue();
                if (!(raw instanceof float[][])) throw new IllegalArgumentException("ONNX-модель вернула неожиданный формат logits");
                float[][] logits = (float[][]) raw;
                float[] scores = new float[logits.length];
                for (int i = 0; i < logits.length; i++) scores[i] = softmaxAt(logits[i], m.entailmentIndex);
                return scores;
            }
        }
    }

    private static float softmaxAt(float[] logits, int index) {
        if (logits == null || logits.length == 0 || index < 0 || index >= logits.length) return 0f;
        double max = -Double.MAX_VALUE;
        for (float v : logits) max = Math.max(max, v);
        double sum = 0.0;
        for (float v : logits) sum += Math.exp(v - max);
        return (float) (Math.exp(logits[index] - max) / Math.max(1e-12, sum));
    }

    private List<Category> parseCategories(String json) {
        List<Category> out = new ArrayList<>();
        JSONArray array;
        try { array = new JSONArray(json == null ? "[]" : json); }
        catch (Exception e) { return out; }
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < array.length() && out.size() < MAX_CATEGORIES; i++) {
            JSONObject o = array.optJSONObject(i);
            if (o == null || !o.optBoolean("enabled", true)) continue;
            String name = clean(o.optString("name", ""), 80);
            String description = clean(o.optString("description", ""), 420);
            if (name.isEmpty() || description.isEmpty()) continue;
            String id = slug(o.optString("id", name));
            if (id.isEmpty() || !ids.add(id)) continue;
            double thresholdRaw = o.optDouble("threshold", 0.72);
            float threshold = (float) Math.max(0.05, Math.min(0.99, thresholdRaw));
            out.add(new Category(id, name, description, threshold));
        }
        return out;
    }

    private static List<Segment> splitSegments(String source) {
        if (source == null || source.trim().isEmpty()) return Collections.emptyList();
        BreakIterator iterator = BreakIterator.getSentenceInstance(new Locale("ru", "RU"));
        iterator.setText(source);
        List<Segment> result = new ArrayList<>();
        int rawStart = iterator.first();
        int rawEnd = iterator.next();
        int id = 1;
        while (rawEnd != BreakIterator.DONE && result.size() < MAX_SEGMENTS + 1) {
            int start = rawStart, end = rawEnd;
            while (start < end && Character.isWhitespace(source.charAt(start))) start++;
            while (end > start && Character.isWhitespace(source.charAt(end - 1))) end--;
            if (end > start) {
                String text = source.substring(start, end);
                if (containsLetterOrDigit(text)) {
                    if (text.length() > MAX_SEGMENT_CHARS) text = text.substring(0, MAX_SEGMENT_CHARS);
                    result.add(new Segment(id++, start, Math.min(end, start + text.length()), text));
                }
            }
            rawStart = rawEnd;
            rawEnd = iterator.next();
        }
        return result;
    }

    private static boolean containsLetterOrDigit(String s) {
        for (int i = 0; i < s.length(); i++) if (Character.isLetterOrDigit(s.charAt(i))) return true;
        return false;
    }

    private ModelMeta readMeta(File file) throws Exception {
        StringBuilder b = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (b.length() > MAX_META_BYTES) throw new IllegalArgumentException("metadata.json слишком большой");
                b.append(line).append('\n');
            }
        }
        JSONObject o = new JSONObject(b.toString());
        if (!SCHEMA.equals(o.optString("schema"))) throw new IllegalArgumentException("Неподдерживаемый формат пакета модели");
        int maxLength = Math.max(64, Math.min(512, o.optInt("max_length", 192)));
        int entailmentIndex = o.optInt("entailment_index", -1);
        String name = clean(o.optString("name", "NLI-модель"), 120);
        String version = clean(o.optString("version", "1"), 40);
        String source = clean(o.optString("source", ""), 220);
        return new ModelMeta(name.isEmpty() ? "NLI-модель" : name, version, source, maxLength, entailmentIndex);
    }

    private boolean packageLooksPresent(File dir) {
        return dir.isDirectory() && new File(dir, MODEL).isFile() && new File(dir, VOCAB).isFile() && new File(dir, META).isFile();
    }

    private void closeLoaded() {
        if (session != null) {
            try { session.close(); } catch (Exception ignored) { }
        }
        session = null;
        tokenizer = null;
        meta = null;
    }

    @Override public synchronized void close() { closeLoaded(); }

    private static boolean deleteTree(File file) {
        if (file == null || !file.exists()) return true;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteTree(child);
        }
        return !file.exists() || file.delete();
    }

    private static String clean(String value, int max) {
        String s = value == null ? "" : value.replace('\u0000', ' ').trim().replaceAll("\\s+", " ");
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static String slug(String value) {
        String s = value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^a-zа-яё0-9]+", "-").replaceAll("^-+|-+$", "");
        return s.length() <= 64 ? s : s.substring(0, 64);
    }

    private static String safeMessage(Throwable t) {
        String m = t == null ? "Неизвестная ошибка" : t.getMessage();
        if (m == null || m.trim().isEmpty()) m = t == null ? "Ошибка" : t.getClass().getSimpleName();
        m = m.trim();
        return m.length() <= 500 ? m : m.substring(0, 500);
    }

    private static final class ModelMeta {
        final String name, version, source;
        final int maxLength, entailmentIndex;
        ModelMeta(String name, String version, String source, int maxLength, int entailmentIndex) {
            this.name = name; this.version = version; this.source = source; this.maxLength = maxLength; this.entailmentIndex = entailmentIndex;
        }
    }

    private static final class Category {
        final String id, name, description;
        final float threshold;
        Category(String id, String name, String description, float threshold) {
            this.id = id; this.name = name; this.description = description; this.threshold = threshold;
        }
    }

    private static final class Segment {
        final int id, start, end;
        final String text;
        Segment(int id, int start, int end, String text) { this.id = id; this.start = start; this.end = end; this.text = text; }
    }

    private static final class PairWork {
        final Segment segment;
        final Category category;
        PairWork(Segment segment, Category category) { this.segment = segment; this.category = category; }
    }

    private static final class EncodedPair {
        final long[] ids, types;
        EncodedPair(long[] ids, long[] types) { this.ids = ids; this.types = types; }
    }

    /** Minimal BERT tokenizer compatible with the cased RuBERT-tiny vocabulary. */
    private static final class WordPieceTokenizer {
        private final Map<String, Integer> vocab = new LinkedHashMap<>();
        private final int maxLength;
        private final int unkId, clsId, sepId;

        WordPieceTokenizer(File vocabFile, int maxLength) throws Exception {
            this.maxLength = maxLength;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(vocabFile), StandardCharsets.UTF_8))) {
                String line; int id = 0;
                while ((line = r.readLine()) != null) vocab.put(line, id++);
            }
            if (vocab.size() < 1000) throw new IllegalArgumentException("Словарь токенизатора повреждён");
            unkId = required("[UNK]"); clsId = required("[CLS]"); sepId = required("[SEP]");
        }

        private int required(String token) {
            Integer id = vocab.get(token);
            if (id == null) throw new IllegalArgumentException("В словаре нет токена " + token);
            return id;
        }

        EncodedPair encodePair(String premise, String hypothesis) {
            List<Integer> a = tokenize(premise);
            List<Integer> b = tokenize(hypothesis);
            int budget = Math.max(8, maxLength - 3);
            while (a.size() + b.size() > budget) {
                if (a.size() >= b.size() && !a.isEmpty()) a.remove(a.size() - 1);
                else if (!b.isEmpty()) b.remove(b.size() - 1);
                else break;
            }
            int n = 3 + a.size() + b.size();
            long[] ids = new long[n];
            long[] types = new long[n];
            int p = 0;
            ids[p++] = clsId;
            for (int id : a) ids[p++] = id;
            ids[p++] = sepId;
            for (int id : b) { ids[p] = id; types[p] = 1L; p++; }
            ids[p] = sepId; types[p] = 1L;
            return new EncodedPair(ids, types);
        }

        private List<Integer> tokenize(String text) {
            List<String> basic = basicTokens(text == null ? "" : text);
            List<Integer> ids = new ArrayList<>();
            for (String token : basic) {
                if (token.length() > 100) { ids.add(unkId); continue; }
                Integer whole = vocab.get(token);
                if (whole != null) { ids.add(whole); continue; }
                int start = 0;
                List<Integer> pieces = new ArrayList<>();
                boolean bad = false;
                while (start < token.length()) {
                    int end = token.length();
                    Integer found = null;
                    int foundEnd = -1;
                    while (end > start) {
                        String sub = token.substring(start, end);
                        if (start > 0) sub = "##" + sub;
                        Integer id = vocab.get(sub);
                        if (id != null) { found = id; foundEnd = end; break; }
                        end--;
                    }
                    if (found == null) { bad = true; break; }
                    pieces.add(found);
                    start = foundEnd;
                }
                if (bad) ids.add(unkId); else ids.addAll(pieces);
            }
            return ids;
        }

        private static List<String> basicTokens(String text) {
            List<String> out = new ArrayList<>();
            StringBuilder word = new StringBuilder();
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                if (Character.isWhitespace(c) || Character.isISOControl(c)) {
                    flush(word, out);
                } else if (isPunctuation(c)) {
                    flush(word, out);
                    out.add(String.valueOf(c));
                } else {
                    word.append(c);
                }
            }
            flush(word, out);
            return out;
        }

        private static void flush(StringBuilder b, List<String> out) {
            if (b.length() > 0) { out.add(b.toString()); b.setLength(0); }
        }

        private static boolean isPunctuation(char c) {
            if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) return true;
            int t = Character.getType(c);
            return t == Character.CONNECTOR_PUNCTUATION || t == Character.DASH_PUNCTUATION || t == Character.START_PUNCTUATION ||
                    t == Character.END_PUNCTUATION || t == Character.INITIAL_QUOTE_PUNCTUATION || t == Character.FINAL_QUOTE_PUNCTUATION ||
                    t == Character.OTHER_PUNCTUATION;
        }
    }
}
