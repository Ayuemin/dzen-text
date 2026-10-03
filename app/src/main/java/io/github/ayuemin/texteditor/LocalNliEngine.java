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
 * Fully-local zero-shot NLI classifier for semantic review.
 *
 * Long texts use two stages:
 * 1) coarse blocks are screened once against each signal hypothesis;
 * 2) only sentences from suspicious blocks receive the full signal-vs-safe comparison.
 * This keeps normal articles responsive without turning semantic review into a minutes-long
 * sentence x category x two-hypothesis exhaustive pass.
 */
final class LocalNliEngine implements AutoCloseable {
    private static final String SCHEMA = "local-nli-model-v1";
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
    private static final int MAX_SENTENCES = 1000;
    private static final int MAX_SENTENCE_CHARS = 1200;
    private static final int DIRECT_SENTENCE_LIMIT = 18;
    private static final int MAX_COARSE_CHUNKS = 120;
    private static final int MIN_COARSE_CHARS = 420;
    private static final int MAX_COARSE_CHARS = 900;
    // Pair batches expand to two ONNX rows during the final contrast pass.
    private static final int BATCH_SIZE = 16;
    private static final int MAX_ISSUES = 180;
    private static final long MAX_ANALYSIS_MS = 25_000L;
    private static final float SCREEN_SIGNAL_FLOOR = 0.35f;
    private static final float MIN_SIGNAL_SCORE = 0.50f;
    private static final String GENERIC_SAFE = "Текст нейтрально обсуждает эту тему, предупреждает о ней или осуждает её без предложения совершить действие.";

    private final File rootDir;
    private final File activeDir;
    private final File candidateDir;
    private final File backupDir;
    private final OrtEnvironment environment;

    private OrtSession session;
    private WordPieceTokenizer tokenizer;
    private ModelMeta meta;
    private String lastError = "";
    private volatile boolean cancelRequested = false;

    LocalNliEngine(Context context) {
        Context appContext = context.getApplicationContext();
        rootDir = new File(appContext.getFilesDir(), DIR);
        activeDir = new File(rootDir, ACTIVE);
        candidateDir = new File(rootDir, CANDIDATE);
        backupDir = new File(rootDir, BACKUP);
        environment = OrtEnvironment.getEnvironment();
    }

    void requestCancel() {
        cancelRequested = true;
    }

    synchronized String statusJson() {
        JSONObject out = new JSONObject();
        boolean installed = packageLooksPresent(activeDir);
        put(out, "engine", "ONNX Runtime");
        put(out, "kind", "contrastive NLI zero-shot classifier");
        put(out, "installed", installed);
        put(out, "available", installed);
        if (installed) {
            try {
                ModelMeta m = readMeta(new File(activeDir, META));
                put(out, "name", m.name);
                put(out, "version", m.version);
                put(out, "source", m.source);
                put(out, "sizeBytes", new File(activeDir, MODEL).length());
                put(out, "maxLength", m.maxLength);
            } catch (Exception e) {
                put(out, "available", false);
                put(out, "error", safeMessage(e));
            }
        }
        if (!lastError.isEmpty() && !out.has("error")) put(out, "error", lastError);
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
        long deadline = started + MAX_ANALYSIS_MS;
        cancelRequested = false;
        int runs = 0;
        int comparisons = 0;
        int screeningChunks = 0;
        int candidatePairs = 0;
        boolean timedOut = false;
        boolean cancelled = false;
        boolean truncated = false;
        try {
            ensureLoaded();
            List<Category> categories = parseCategories(categoriesJson);
            if (categories.isEmpty()) {
                return finish(out, issues, 0, 0, 0, 0, 0, false, false, false, started);
            }

            List<Segment> allSentences = splitSentences(source == null ? "" : source);
            truncated = allSentences.size() > MAX_SENTENCES;
            List<Segment> sentences = truncated ? new ArrayList<>(allSentences.subList(0, MAX_SENTENCES)) : allSentences;
            if (sentences.isEmpty()) {
                return finish(out, issues, 0, categories.size(), 0, 0, 0, truncated, false, false, started);
            }

            if (sentences.size() <= DIRECT_SENTENCE_LIMIT) {
                List<PairWork> direct = makePairs(sentences, categories);
                for (int offset = 0; offset < direct.size() && issues.length() < MAX_ISSUES; offset += BATCH_SIZE) {
                    if (cancelRequested) { cancelled = true; break; }
                    if (System.currentTimeMillis() >= deadline) { timedOut = true; break; }
                    int end = Math.min(direct.size(), offset + BATCH_SIZE);
                    List<PairWork> batch = direct.subList(offset, end);
                    ContrastScore[] scores = runContrastBatch(batch);
                    runs++;
                    comparisons += batch.size() * 2;
                    appendMatches(issues, batch, scores);
                }
                lastError = "";
                return finish(out, issues, sentences.size(), categories.size(), comparisons, runs, 0,
                        truncated, timedOut, cancelled, started);
            }

            // Stage 1: screen compact blocks with only the signal hypothesis.
            List<Segment> chunks = buildCoarseSegments(source == null ? "" : source, sentences);
            screeningChunks = chunks.size();
            List<PairWork> screenPairs = makePairs(chunks, categories);
            LinkedHashMap<String, PairWork> drillPairs = new LinkedHashMap<>();
            for (int offset = 0; offset < screenPairs.size(); offset += BATCH_SIZE * 2) {
                if (cancelRequested) { cancelled = true; break; }
                if (System.currentTimeMillis() >= deadline) { timedOut = true; break; }
                int end = Math.min(screenPairs.size(), offset + BATCH_SIZE * 2);
                List<PairWork> batch = screenPairs.subList(offset, end);
                float[] signalScores = runSignalBatch(batch);
                runs++;
                comparisons += batch.size();
                for (int i = 0; i < batch.size(); i++) {
                    if (signalScores[i] < SCREEN_SIGNAL_FLOOR) continue;
                    PairWork coarse = batch.get(i);
                    for (Segment sentence : sentences) {
                        if (sentence.end <= coarse.segment.start) continue;
                        if (sentence.start >= coarse.segment.end) break;
                        if (sentence.start < coarse.segment.end && sentence.end > coarse.segment.start) {
                            String key = sentence.id + "\u0000" + coarse.category.id;
                            drillPairs.put(key, new PairWork(sentence, coarse.category));
                        }
                    }
                }
            }

            // Stage 2: only suspicious sentence/category pairs get the full contrast pass.
            if (!cancelled && !timedOut && !drillPairs.isEmpty()) {
                List<PairWork> drill = new ArrayList<>(drillPairs.values());
                candidatePairs = drill.size();
                for (int offset = 0; offset < drill.size() && issues.length() < MAX_ISSUES; offset += BATCH_SIZE) {
                    if (cancelRequested) { cancelled = true; break; }
                    if (System.currentTimeMillis() >= deadline) { timedOut = true; break; }
                    int end = Math.min(drill.size(), offset + BATCH_SIZE);
                    List<PairWork> batch = drill.subList(offset, end);
                    ContrastScore[] scores = runContrastBatch(batch);
                    runs++;
                    comparisons += batch.size() * 2;
                    appendMatches(issues, batch, scores);
                }
            }

            lastError = "";
            String json = finish(out, issues, sentences.size(), categories.size(), comparisons, runs,
                    screeningChunks, truncated, timedOut, cancelled, started);
            try { out.put("candidatePairs", candidatePairs); } catch (Exception ignored) { }
            return out.toString();
        } catch (Throwable t) {
            lastError = safeMessage(t);
            put(out, "available", false);
            put(out, "issues", issues);
            put(out, "error", lastError);
            put(out, "elapsedMs", System.currentTimeMillis() - started);
            return out.toString();
        }
    }

    private String finish(JSONObject out, JSONArray issues, int sentences, int categories, int comparisons,
                          int runs, int screeningChunks, boolean truncated, boolean timedOut,
                          boolean cancelled, long started) {
        put(out, "available", true);
        put(out, "issues", issues);
        put(out, "segments", sentences);
        put(out, "categories", categories);
        put(out, "pairs", comparisons);
        put(out, "runs", runs);
        put(out, "screeningChunks", screeningChunks);
        put(out, "truncated", truncated);
        put(out, "timedOut", timedOut);
        put(out, "cancelled", cancelled);
        put(out, "partial", truncated || timedOut || cancelled);
        put(out, "elapsedMs", System.currentTimeMillis() - started);
        if (meta != null) put(out, "modelName", meta.name);
        return out.toString();
    }

    private void appendMatches(JSONArray issues, List<PairWork> batch, ContrastScore[] scores) throws Exception {
        Set<String> existing = new HashSet<>();
        for (int i = 0; i < issues.length(); i++) {
            JSONObject old = issues.optJSONObject(i);
            if (old != null) existing.add(old.optInt("start", -1) + "\u0000" + old.optInt("end", -1) + "\u0000" + old.optString("id", ""));
        }
        for (int i = 0; i < batch.size() && issues.length() < MAX_ISSUES; i++) {
            PairWork work = batch.get(i);
            ContrastScore score = scores[i];
            if (score.signal < MIN_SIGNAL_SCORE || score.normalized < work.category.threshold) continue;
            String issueId = "nli-" + work.category.id;
            String key = work.segment.start + "\u0000" + work.segment.end + "\u0000" + issueId;
            if (!existing.add(key)) continue;
            JSONObject issue = new JSONObject();
            issue.put("id", issueId);
            issue.put("category", work.category.name);
            issue.put("title", work.category.name);
            issue.put("message", "Смысл фрагмента ближе к сигналу категории «" + work.category.name + "», чем к безопасному контексту.");
            issue.put("score", score.normalized);
            issue.put("signalScore", score.signal);
            issue.put("safeScore", score.safe);
            issue.put("contrast", score.contrast);
            issue.put("start", work.segment.start);
            issue.put("end", work.segment.end);
            issue.put("severity", "warning");
            issues.put(issue);
        }
    }

    private List<PairWork> makePairs(List<Segment> segments, List<Category> categories) {
        List<PairWork> pairs = new ArrayList<>(Math.max(1, segments.size() * categories.size()));
        for (Segment segment : segments) for (Category category : categories) pairs.add(new PairWork(segment, category));
        return pairs;
    }

    private List<Segment> buildCoarseSegments(String source, List<Segment> sentences) {
        if (sentences.isEmpty()) return Collections.emptyList();
        int dynamic = (int) Math.ceil(Math.max(1, source.length()) / (double) MAX_COARSE_CHUNKS);
        int target = Math.max(MIN_COARSE_CHARS, Math.min(MAX_COARSE_CHARS, dynamic));
        List<Segment> chunks = new ArrayList<>();
        int id = 1;
        int i = 0;
        while (i < sentences.size()) {
            int first = i;
            int start = sentences.get(i).start;
            int end = sentences.get(i).end;
            i++;
            while (i < sentences.size()) {
                Segment next = sentences.get(i);
                int proposed = next.end - start;
                if (proposed > target && i > first) break;
                end = next.end;
                i++;
                if (end - start >= target) break;
            }
            int safeEnd = Math.min(source.length(), end);
            int safeStart = Math.max(0, Math.min(start, safeEnd));
            String text = source.substring(safeStart, safeEnd).trim();
            if (!text.isEmpty()) chunks.add(new Segment(id++, safeStart, safeEnd, text));
        }
        return chunks;
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
            EncodedPair encoded = candidateTokenizer.encodePair("Кошка сидит на ковре.", "кошка на ковре");
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

    private float[] runSignalBatch(List<PairWork> batch) throws Exception {
        List<EncodedPair> encoded = new ArrayList<>(batch.size());
        for (PairWork work : batch) encoded.add(tokenizer.encodePair(work.segment.text, work.category.signal));
        return runEncodedBatch(session, meta, encoded);
    }

    private ContrastScore[] runContrastBatch(List<PairWork> batch) throws Exception {
        List<EncodedPair> encoded = new ArrayList<>(batch.size() * 2);
        for (PairWork work : batch) {
            encoded.add(tokenizer.encodePair(work.segment.text, work.category.signal));
            encoded.add(tokenizer.encodePair(work.segment.text, work.category.safe));
        }
        float[] entailment = runEncodedBatch(session, meta, encoded);
        ContrastScore[] result = new ContrastScore[batch.size()];
        for (int i = 0; i < batch.size(); i++) {
            float signal = entailment[i * 2];
            float safe = entailment[i * 2 + 1];
            float contrast = Math.max(-1f, Math.min(1f, signal - safe));
            float normalized = Math.max(0f, Math.min(1f, 0.5f + contrast * 0.5f));
            result[i] = new ContrastScore(signal, safe, contrast, normalized);
        }
        return result;
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
            String signal = clean(o.optString("signal", o.optString("description", "")), 320);
            String safe = clean(o.optString("safe", GENERIC_SAFE), 320);
            if (name.isEmpty() || signal.isEmpty()) continue;
            if (safe.isEmpty()) safe = GENERIC_SAFE;
            String id = slug(o.optString("id", name));
            if (id.isEmpty() || !ids.add(id)) continue;
            double thresholdRaw = o.optDouble("threshold", 0.60);
            float threshold = (float) Math.max(0.50, Math.min(0.99, thresholdRaw));
            out.add(new Category(id, name, signal, safe, threshold));
        }
        return out;
    }

    private static List<Segment> splitSentences(String source) {
        if (source == null || source.trim().isEmpty()) return Collections.emptyList();
        BreakIterator iterator = BreakIterator.getSentenceInstance(new Locale("ru", "RU"));
        iterator.setText(source);
        List<Segment> result = new ArrayList<>();
        int rawStart = iterator.first();
        int rawEnd = iterator.next();
        int id = 1;
        while (rawEnd != BreakIterator.DONE && result.size() < MAX_SENTENCES + 1) {
            int start = rawStart, end = rawEnd;
            while (start < end && Character.isWhitespace(source.charAt(start))) start++;
            while (end > start && Character.isWhitespace(source.charAt(end - 1))) end--;
            if (end > start) {
                String text = source.substring(start, end);
                if (containsLetterOrDigit(text)) {
                    if (text.length() > MAX_SENTENCE_CHARS) text = text.substring(0, MAX_SENTENCE_CHARS);
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

    private static void put(JSONObject target, String key, Object value) {
        try { target.put(key, value); } catch (Exception ignored) { }
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
        final String id, name, signal, safe;
        final float threshold;
        Category(String id, String name, String signal, String safe, float threshold) {
            this.id = id; this.name = name; this.signal = signal; this.safe = safe; this.threshold = threshold;
        }
    }

    private static final class Segment {
        final int id, start, end;
        final String text;
        Segment(int id, int start, int end, String text) {
            this.id = id; this.start = start; this.end = end; this.text = text;
        }
    }

    private static final class PairWork {
        final Segment segment;
        final Category category;
        PairWork(Segment segment, Category category) {
            this.segment = segment; this.category = category;
        }
    }

    private static final class ContrastScore {
        final float signal, safe, contrast, normalized;
        ContrastScore(float signal, float safe, float contrast, float normalized) {
            this.signal = signal; this.safe = safe; this.contrast = contrast; this.normalized = normalized;
        }
    }

    private static final class EncodedPair {
        final long[] ids, types;
        EncodedPair(long[] ids, long[] types) { this.ids = ids; this.types = types; }
    }

    /** Minimal BERT WordPiece tokenizer compatible with the packaged RuBERT vocabulary. */
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
