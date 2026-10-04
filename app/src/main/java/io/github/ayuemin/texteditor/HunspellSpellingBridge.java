package io.github.ayuemin.texteditor;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Asynchronous WebView bridge for the selected SPELL 01 engine.
 *
 * Initialization and batch checks run on one worker thread. A newer request
 * invalidates callbacks from older requests; JavaScript additionally verifies
 * documentId/revision/textHash before accepting results.
 *
 * Important: the critical batch path performs spell() only. Hunspell suggest()
 * can be much more expensive than dictionary membership checks and must never
 * be able to block the whole document check. Suggestions are therefore
 * intentionally deferred to a separate future path.
 */
final class HunspellSpellingBridge implements AutoCloseable {
    private static final String PREFS = "editor_spelling_v1";
    private static final String USER_WORDS = "user_words";
    private static final int MAX_BATCH_WORDS = 20000;

    private final Context context;
    private final WebView web;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "hunspell-editor");
        t.setDaemon(true);
        return t;
    });
    private final AtomicLong generation = new AtomicLong(0L);

    private volatile HunspellSpellingEngine engine;
    private volatile String state = "initializing";
    private volatile String error = "";
    private volatile long initMillis = 0L;
    private volatile boolean closed = false;

    // Development diagnostics for a batch that is currently executing native code.
    private volatile long activeBatchToken = -1L;
    private volatile String activeRequestId = "";
    private volatile String activeWord = "";
    private volatile int activeWordIndex = 0;
    private volatile int activeWordTotal = 0;

    HunspellSpellingBridge(Context context, WebView web) {
        this.context = context.getApplicationContext();
        this.web = web;
    }

    void start() {
        DevLog.i("SPELL", "engine initialization queued");
        worker.execute(() -> {
            long started = System.currentTimeMillis();
            DevLog.i("SPELL", "engine initialization worker entered");
            try {
                HunspellSpellingEngine ready = new HunspellSpellingEngine(context);
                for (String word : userWordsSet()) ready.addWord(word);
                if (closed) {
                    ready.close();
                    DevLog.w("SPELL", "engine initialized after bridge close; instance discarded");
                    return;
                }
                engine = ready;
                initMillis = ready.initMillis();
                state = "ready";
                error = "";
                DevLog.i("SPELL", "Hunspell ready; initMs=" + initMillis + "; wallMs="
                        + (System.currentTimeMillis() - started) + "; userWords=" + userWordsSet().size());
            } catch (Throwable t) {
                state = "unavailable";
                error = safeMessage(t);
                DevLog.e("SPELL", "Hunspell initialization failed after "
                        + (System.currentTimeMillis() - started) + "ms", t);
            }
            notifyReady();
        });
    }

    @JavascriptInterface
    public String status() {
        return statusJson().toString();
    }

    @JavascriptInterface
    public long checkBatch(String requestId, String wordsJson, int suggestionLimit) {
        final long token = generation.incrementAndGet();
        final String id = requestId == null ? "" : requestId;
        final String payload = wordsJson == null ? "[]" : wordsJson;
        DevLog.i("SPELL", "checkBatch accepted; request=" + id + "; token=" + token
                + "; payloadChars=" + payload.length() + "; suggestionLimitArg=" + suggestionLimit
                + "; state=" + state);
        worker.execute(() -> runBatch(token, id, payload));
        return token;
    }

    @JavascriptInterface
    public void cancel() {
        long before = generation.get();
        long after = generation.incrementAndGet();
        DevLog.w("SPELL", "cancel requested; generation " + before + " -> " + after
                + "; activeToken=" + activeBatchToken + "; activeRequest=" + activeRequestId
                + "; activeWord=" + activeWord + "; index=" + activeWordIndex + "/" + activeWordTotal);
    }

    @JavascriptInterface
    public boolean addUserWord(String raw) {
        String word = normalizeUserWord(raw);
        if (word.isEmpty()) return false;
        Set<String> words = userWordsSet();
        if (!words.add(word)) return true;
        if (!saveUserWords(words)) return false;
        worker.execute(() -> {
            HunspellSpellingEngine value = engine;
            if (value != null) value.addWord(word);
        });
        notifyUserWordsChanged();
        return true;
    }

    @JavascriptInterface
    public boolean removeUserWord(String raw) {
        String word = normalizeUserWord(raw);
        if (word.isEmpty()) return false;
        Set<String> words = userWordsSet();
        if (!words.remove(word)) return false;
        if (!saveUserWords(words)) return false;
        restartEngine();
        notifyUserWordsChanged();
        return true;
    }

    @JavascriptInterface
    public String userWords() {
        JSONArray out = new JSONArray();
        List<String> words = new ArrayList<>(userWordsSet());
        Collections.sort(words, String.CASE_INSENSITIVE_ORDER);
        for (String word : words) out.put(word);
        return out.toString();
    }

    @JavascriptInterface
    public boolean clearUserWords() {
        if (!saveUserWords(new LinkedHashSet<>())) return false;
        restartEngine();
        notifyUserWordsChanged();
        return true;
    }

    private void runBatch(long token, String requestId, String wordsJson) {
        JSONObject out = new JSONObject();
        final Thread batchThread = Thread.currentThread();
        final long wallStarted = System.currentTimeMillis();
        activeBatchToken = token;
        activeRequestId = requestId;
        activeWord = "<preflight>";
        activeWordIndex = 0;
        activeWordTotal = 0;
        startBatchWatchdog(token, requestId, batchThread, wallStarted);
        DevLog.i("SPELL", "batch worker entered; request=" + requestId + "; token=" + token
                + "; generation=" + generation.get() + "; jsonChars=" + wordsJson.length());
        try {
            out.put("requestId", requestId);
            out.put("moduleVersion", HunspellSpellingEngine.MODULE_VERSION);
            if (closed || token != generation.get()) {
                DevLog.w("SPELL", "batch abandoned before engine lookup; request=" + requestId
                        + "; closed=" + closed + "; token=" + token + "; generation=" + generation.get());
                return;
            }
            HunspellSpellingEngine value = engine;
            if (!"ready".equals(state) || value == null) {
                DevLog.w("SPELL", "batch cannot run: state=" + state + "; engineNull=" + (value == null));
                out.put("state", state);
                if (!error.isEmpty()) out.put("error", error);
                deliverBatch(token, requestId, out);
                return;
            }

            JSONArray input = new JSONArray(wordsJson);
            JSONArray misspelled = new JSONArray();
            LinkedHashSet<String> unique = new LinkedHashSet<>();
            int count = Math.min(input.length(), MAX_BATCH_WORDS);
            int filtered = 0;
            for (int i = 0; i < count; i++) {
                String word = input.optString(i, "").trim();
                if (word.isEmpty() || word.length() > 80) continue;
                if (!isSafeRussianSpellToken(word)) {
                    filtered++;
                    continue;
                }
                unique.add(word);
            }
            activeWordTotal = unique.size();
            DevLog.i("SPELL", "batch preflight complete; request=" + requestId + "; input=" + input.length()
                    + "; limited=" + count + "; unique=" + unique.size() + "; filtered=" + filtered
                    + "; words=" + summarizeWords(unique));

            long started = System.nanoTime();
            int checked = 0;
            final boolean verboseWords = unique.size() <= 200;
            for (String word : unique) {
                if (closed || token != generation.get()) {
                    DevLog.w("SPELL", "batch cancelled between words; request=" + requestId
                            + "; checked=" + checked + "; token=" + token + "; generation=" + generation.get());
                    return;
                }
                checked++;
                activeWord = word;
                activeWordIndex = checked;
                long wordStarted = System.nanoTime();
                if (verboseWords || checked <= 20 || checked % 100 == 0) {
                    DevLog.i("SPELL-WORD", "BEGIN request=" + requestId + " " + checked + "/" + unique.size()
                            + " word=" + word);
                }
                boolean isMisspelled = value.isMisspelled(word);
                double wordMs = (System.nanoTime() - wordStarted) / 1_000_000.0;
                if (verboseWords || checked <= 20 || checked % 100 == 0 || wordMs >= 100.0) {
                    DevLog.i("SPELL-WORD", "END request=" + requestId + " " + checked + "/" + unique.size()
                            + " word=" + word + "; misspelled=" + isMisspelled + "; ms=" + wordMs);
                }
                if (!isMisspelled) continue;
                JSONObject miss = new JSONObject();
                miss.put("word", word);
                miss.put("suggestions", new JSONArray());
                misspelled.put(miss);
            }
            activeWord = "<deliver>";
            double durationMs = (System.nanoTime() - started) / 1_000_000.0;
            out.put("state", "ready");
            out.put("checked", checked);
            out.put("filtered", filtered);
            out.put("misspelled", misspelled);
            out.put("durationMs", durationMs);
            out.put("suggestionsDeferred", true);
            DevLog.i("SPELL", "batch engine complete; request=" + requestId + "; checked=" + checked
                    + "; filtered=" + filtered + "; misspelled=" + misspelled.length()
                    + "; suggestions=deferred; engineMs=" + durationMs + "; wallMs="
                    + (System.currentTimeMillis() - wallStarted));
            deliverBatch(token, requestId, out);
        } catch (Throwable t) {
            try {
                out.put("requestId", requestId);
                out.put("state", "error");
                out.put("error", safeMessage(t));
            } catch (Exception ignored) { }
            deliverBatch(token, requestId, out);
            DevLog.e("SPELL", "Hunspell batch failed; request=" + requestId + "; activeWord=" + activeWord, t);
        } finally {
            if (activeBatchToken == token) {
                activeBatchToken = -1L;
                activeRequestId = "";
                activeWord = "";
                activeWordIndex = 0;
                activeWordTotal = 0;
            }
            DevLog.i("SPELL", "batch worker exit; request=" + requestId + "; token=" + token
                    + "; wallMs=" + (System.currentTimeMillis() - wallStarted)
                    + "; generation=" + generation.get());
        }
    }

    private void startBatchWatchdog(long token, String requestId, Thread workerThread, long started) {
        Thread watchdog = new Thread(() -> {
            int tick = 0;
            while (!closed && activeBatchToken == token) {
                try {
                    Thread.sleep(2000L);
                } catch (InterruptedException e) {
                    return;
                }
                if (closed || activeBatchToken != token) return;
                tick++;
                DevLog.w("SPELL-WATCH", "request=" + requestId + "; token=" + token + "; tick=" + tick
                        + "; elapsedMs=" + (System.currentTimeMillis() - started)
                        + "; generation=" + generation.get() + "; activeWord=" + activeWord
                        + "; index=" + activeWordIndex + "/" + activeWordTotal + "\n"
                        + DevLog.stackSummary(workerThread));
            }
        }, "hunspell-watchdog-" + token);
        watchdog.setDaemon(true);
        watchdog.start();
    }

    private static String summarizeWords(Set<String> words) {
        StringBuilder b = new StringBuilder("[");
        int i = 0;
        for (String word : words) {
            if (i > 0) b.append(", ");
            if (i >= 80) {
                b.append("…+").append(words.size() - i);
                break;
            }
            b.append(word);
            i++;
        }
        return b.append(']').toString();
    }

    /**
     * SPELL04 preflight belongs before Hunspell, not only in JS post-processing.
     * Mixed Cyrillic/Latin product names can make suggestion generation very
     * expensive and are owned by the alphabet-mixing rule rather than spelling.
     */
    static boolean isSafeRussianSpellToken(String raw) {
        String word = raw == null ? "" : raw.trim();
        if (word.isEmpty() || word.length() > 80) return false;
        if (!word.matches(".*[А-Яа-яЁё].*")) return false;
        if (word.matches(".*[0-9].*")) return false;
        if (word.matches(".*[A-Za-z].*")) return false;
        if (word.matches("[А-Яа-яЁё]")) return false;
        if (word.matches("[А-ЯЁ]{2,12}(?:-[А-ЯЁ]{1,12})*")) return false;
        return word.matches("[А-Яа-яЁё]+(?:[-’'][А-Яа-яЁё]+)*");
    }

    private void deliverBatch(long token, String requestId, JSONObject out) {
        if (closed || token != generation.get()) {
            DevLog.w("SPELL", "batch delivery skipped; request=" + requestId + "; token=" + token
                    + "; generation=" + generation.get() + "; closed=" + closed);
            return;
        }
        String script = "(()=>{if(typeof window.onNativeSpellingBatch!=='function')return 'missing';" +
                "window.onNativeSpellingBatch(" + JSONObject.quote(requestId) + "," + JSONObject.quote(out.toString()) + ");" +
                "return 'called'})()";
        DevLog.i("SPELL", "queue JS batch callback; request=" + requestId + "; payloadChars=" + out.toString().length());
        runJs(script, "batch-callback request=" + requestId);
    }

    private void notifyReady() {
        String payload = statusJson().toString();
        String script = "(()=>{if(typeof window.onNativeSpellingReady!=='function')return 'missing';" +
                "window.onNativeSpellingReady(" + JSONObject.quote(payload) + ");return 'called'})()";
        DevLog.i("SPELL", "queue JS ready callback; state=" + state + "; payload=" + payload);
        runJs(script, "ready-callback");
    }

    private void notifyUserWordsChanged() {
        runJs("window.onNativeSpellingUserWordsChanged&&window.onNativeSpellingUserWordsChanged()", "user-words-callback");
    }

    private JSONObject statusJson() {
        JSONObject out = new JSONObject();
        try {
            out.put("state", state);
            out.put("engine", "Hunspell");
            out.put("engineVersion", HunspellSpellingEngine.ENGINE_VERSION);
            out.put("engineCommit", HunspellSpellingEngine.ENGINE_COMMIT);
            out.put("dictionary", "LibreOffice ru_RU");
            out.put("dictionaryCommit", HunspellSpellingEngine.DICTIONARY_COMMIT);
            out.put("moduleVersion", HunspellSpellingEngine.MODULE_VERSION);
            out.put("initMs", initMillis);
            out.put("userWords", userWordsSet().size());
            out.put("generation", generation.get());
            out.put("activeRequest", activeRequestId);
            out.put("activeWord", activeWord);
            out.put("activeIndex", activeWordIndex);
            out.put("activeTotal", activeWordTotal);
            if (!error.isEmpty()) out.put("error", error);
        } catch (Exception ignored) { }
        return out;
    }

    private void restartEngine() {
        final long token = generation.incrementAndGet();
        state = "initializing";
        error = "";
        DevLog.i("SPELL", "engine restart queued; token=" + token);
        worker.execute(() -> {
            HunspellSpellingEngine old = engine;
            engine = null;
            if (old != null) old.close();
            try {
                HunspellSpellingEngine ready = new HunspellSpellingEngine(context);
                for (String word : userWordsSet()) ready.addWord(word);
                if (closed || token != generation.get()) {
                    ready.close();
                    return;
                }
                engine = ready;
                initMillis = ready.initMillis();
                state = "ready";
                DevLog.i("SPELL", "engine restart complete; token=" + token + "; initMs=" + initMillis);
            } catch (Throwable t) {
                state = "unavailable";
                error = safeMessage(t);
                DevLog.e("SPELL", "Hunspell restart failed", t);
            }
            notifyReady();
        });
    }

    private Set<String> userWordsSet() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> saved = prefs.getStringSet(USER_WORDS, Collections.emptySet());
        return new LinkedHashSet<>(saved == null ? Collections.emptySet() : saved);
    }

    private boolean saveUserWords(Set<String> words) {
        try {
            return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putStringSet(USER_WORDS, new LinkedHashSet<>(words)).commit();
        } catch (Throwable t) {
            DevLog.e("SPELL", "Cannot persist user dictionary", t);
            return false;
        }
    }

    private static String normalizeUserWord(String raw) {
        String word = raw == null ? "" : raw.trim();
        if (word.isEmpty() || word.length() > 80) return "";
        if (!word.matches("(?iu)[a-zа-яё][a-zа-яё'’\\-]*")) return "";
        return word;
    }

    private static String safeMessage(Throwable t) {
        if (t == null) return "unknown error";
        String message = t.getMessage();
        return (message == null || message.trim().isEmpty()) ? t.getClass().getSimpleName() : message.trim();
    }

    private void runJs(String script, String label) {
        if (closed || web == null) {
            DevLog.w("WEB", "evaluateJavascript skipped for " + label + "; closed=" + closed + "; webNull=" + (web == null));
            return;
        }
        web.post(() -> {
            if (closed) return;
            try {
                DevLog.i("WEB", "evaluateJavascript begin: " + label);
                web.evaluateJavascript(script, value -> DevLog.i("WEB", "evaluateJavascript result: " + label + " -> " + value));
            } catch (Throwable t) {
                DevLog.e("WEB", "evaluateJavascript failed: " + label, t);
            }
        });
    }

    @Override
    public void close() {
        if (closed) return;
        DevLog.i("SPELL", "bridge close; generation=" + generation.get() + "; activeRequest=" + activeRequestId
                + "; activeWord=" + activeWord);
        closed = true;
        generation.incrementAndGet();
        HunspellSpellingEngine value = engine;
        engine = null;
        if (value != null) worker.execute(value::close);
        worker.shutdown();
    }
}
