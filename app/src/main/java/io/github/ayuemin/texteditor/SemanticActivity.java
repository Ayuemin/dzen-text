package io.github.ayuemin.texteditor;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** MainActivity plus optional experimental local semantic analysis. */
public class SemanticActivity extends MainActivity {
    private static final int REQUEST_OPEN_LOCAL_NLI = 2916;
    private static final String EDITOR_URL = "file:///android_asset/www/index.html";

    private LocalNliEngine localNli;
    private WebView semanticWebView;
    private final AtomicBoolean semanticBusy = new AtomicBoolean(false);
    private final AtomicLong requestSeq = new AtomicLong(0L);

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        DevLog.init(this);
        DevLog.i("APP", "SemanticActivity.onCreate; MainActivity initialized; savedState=" + (state != null));
        localNli = new LocalNliEngine(this);
        semanticWebView = findWebView(findViewById(android.R.id.content));
        if (semanticWebView != null) {
            DevLog.i("WEB", "WebView found; stopping initial asset load and attaching native bridges");
            semanticWebView.stopLoading();
            semanticWebView.addJavascriptInterface(new LocalNliBridge(this, localNli), "AndroidSemanticModel");
            semanticWebView.addJavascriptInterface(new DocumentRevisionBridge(this), "AndroidDocumentRevision");
            semanticWebView.loadUrl(EDITOR_URL);
            DevLog.i("WEB", "editor asset load requested: " + EDITOR_URL);
        } else {
            DevLog.e("WEB", "WebView not found after MainActivity.onCreate", null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        DevLog.i("APP", "onResume; semanticBusy=" + semanticBusy.get());
    }

    @Override
    protected void onPause() {
        DevLog.i("APP", "onPause; semanticBusy=" + semanticBusy.get());
        super.onPause();
    }

    void pickLocalNliModel() {
        DevLog.i("MODEL", "pickLocalNliModel requested; busy=" + semanticBusy.get());
        runOnUiThread(() -> {
            if (semanticBusy.get()) {
                DevLog.w("MODEL", "model picker rejected because semantic analysis is busy");
                notifyModelError("Дождитесь окончания текущей смысловой проверки");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/zip");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/octet-stream", "*/*"});
            try {
                startActivityForResult(intent, REQUEST_OPEN_LOCAL_NLI);
                DevLog.i("MODEL", "Android document picker opened for NLI package");
            } catch (Exception e) {
                DevLog.e("MODEL", "failed to open NLI model picker", e);
                notifyModelError("Не удалось открыть выбор пакета смысловой модели");
            }
        });
    }

    boolean clearLocalNliModel() {
        DevLog.i("MODEL", "clearLocalNliModel requested; busy=" + semanticBusy.get());
        if (semanticBusy.get() || localNli == null) return false;
        boolean removed = localNli.clearModel();
        DevLog.i("MODEL", "clearLocalNliModel result=" + removed);
        return removed;
    }

    boolean cancelLocalNliAnalysis() {
        DevLog.w("SEMANTIC", "cancel requested; busy=" + semanticBusy.get());
        if (!semanticBusy.get() || localNli == null) return false;
        localNli.requestCancel();
        return true;
    }

    long startLocalNliAnalysis(String text, String categoriesJson) {
        if (localNli == null) {
            DevLog.e("SEMANTIC", "start rejected: LocalNliEngine is null", null);
            return -1L;
        }
        final long requestId = requestSeq.incrementAndGet();
        final int textChars = text == null ? 0 : text.length();
        final int categoryChars = categoriesJson == null ? 0 : categoriesJson.length();
        DevLog.i("SEMANTIC", "request #" + requestId + " start requested; textChars=" + textChars
                + "; categoriesJsonChars=" + categoryChars + "; busy=" + semanticBusy.get());
        if (!semanticBusy.compareAndSet(false, true)) {
            DevLog.w("SEMANTIC", "request #" + requestId + " rejected: previous analysis still running");
            notifyAnalysisError(requestId, "Смысловая проверка уже выполняется");
            return -1L;
        }
        new Thread(() -> {
            final Thread worker = Thread.currentThread();
            final long workerStarted = System.currentTimeMillis();
            DevLog.i("SEMANTIC", "request #" + requestId + " worker entered");
            startSemanticWatchdog(requestId, worker, workerStarted);
            try {
                String result = localNli.analyzeJson(text, categoriesJson);
                DevLog.i("SEMANTIC", "request #" + requestId + " engine returned after "
                        + (System.currentTimeMillis() - workerStarted) + "ms; " + summarizeResult(result));
                String processed = postProcessSemanticResult(result);
                DevLog.i("SEMANTIC", "request #" + requestId + " post-process complete; payloadChars="
                        + (processed == null ? 0 : processed.length()));
                notifyAnalysisResult(requestId, processed);
                DevLog.i("SEMANTIC", "request #" + requestId + " JS result callback queued");
            } catch (Throwable e) {
                String message = e.getMessage();
                if (message == null || message.trim().isEmpty()) message = e.getClass().getSimpleName();
                DevLog.e("SEMANTIC", "request #" + requestId + " worker failed", e);
                notifyAnalysisError(requestId, message);
            } finally {
                semanticBusy.set(false);
                DevLog.i("SEMANTIC", "request #" + requestId + " worker finished; totalMs="
                        + (System.currentTimeMillis() - workerStarted));
            }
        }, "local-nli-analysis-" + requestId).start();
        return requestId;
    }

    private void startSemanticWatchdog(long requestId, Thread worker, long started) {
        Thread watchdog = new Thread(() -> {
            int tick = 0;
            while (worker.isAlive()) {
                try { Thread.sleep(5000L); }
                catch (InterruptedException e) { return; }
                if (!worker.isAlive()) return;
                tick++;
                long elapsed = System.currentTimeMillis() - started;
                DevLog.w("WATCHDOG", "request #" + requestId + " still running; tick=" + tick
                        + "; elapsedMs=" + elapsed + "\n" + DevLog.stackSummary(worker));
            }
        }, "semantic-watchdog-" + requestId);
        watchdog.setDaemon(true);
        watchdog.start();
    }

    private String summarizeResult(String json) {
        try {
            JSONObject o = new JSONObject(json == null ? "{}" : json);
            JSONArray issues = o.optJSONArray("issues");
            return "available=" + o.optBoolean("available", false)
                    + "; issues=" + (issues == null ? 0 : issues.length())
                    + "; segments=" + o.optInt("segments", -1)
                    + "; categories=" + o.optInt("categories", -1)
                    + "; comparisons=" + o.optInt("pairs", -1)
                    + "; runs=" + o.optInt("runs", -1)
                    + "; screeningChunks=" + o.optInt("screeningChunks", -1)
                    + "; candidatePairs=" + o.optInt("candidatePairs", -1)
                    + "; timedOut=" + o.optBoolean("timedOut", false)
                    + "; cancelled=" + o.optBoolean("cancelled", false)
                    + "; partial=" + o.optBoolean("partial", false)
                    + "; elapsedMs=" + o.optLong("elapsedMs", -1L)
                    + (o.optString("error", "").isEmpty() ? "" : "; error=" + o.optString("error"));
        } catch (Exception e) {
            return "unparseable result; chars=" + (json == null ? 0 : json.length()) + "; " + e.getMessage();
        }
    }

    private String postProcessSemanticResult(String resultJson) {
        if (resultJson == null || resultJson.trim().isEmpty()) return resultJson;
        try {
            JSONObject root = new JSONObject(resultJson);
            JSONArray issues = root.optJSONArray("issues");
            if (issues == null || issues.length() < 2) return resultJson;
            int before = issues.length();

            Map<String, Set<String>> categoriesBySegment = new HashMap<>();
            for (int i = 0; i < issues.length(); i++) {
                JSONObject issue = issues.optJSONObject(i);
                if (issue == null) continue;
                String key = issue.optInt("start", -1) + ":" + issue.optInt("end", -1);
                Set<String> names = categoriesBySegment.get(key);
                if (names == null) {
                    names = new HashSet<>();
                    categoriesBySegment.put(key, names);
                }
                names.add(issue.optString("category", ""));
            }

            JSONArray filtered = new JSONArray();
            for (int i = 0; i < issues.length(); i++) {
                JSONObject issue = issues.optJSONObject(i);
                if (issue == null) continue;
                String category = issue.optString("category", "");
                String key = issue.optInt("start", -1) + ":" + issue.optInt("end", -1);
                Set<String> names = categoriesBySegment.get(key);

                if ("Опасные или незаконные действия".equals(category)
                        && names != null && names.size() > 1) {
                    continue;
                }
                if ("Обход ограничений".equals(category)
                        && names != null && names.contains("Опасные медицинские советы")) {
                    continue;
                }
                filtered.put(issue);
            }
            root.put("issues", filtered);
            DevLog.i("SEMANTIC", "post-process filtered issues " + before + " -> " + filtered.length());
            return root.toString();
        } catch (Exception e) {
            DevLog.e("SEMANTIC", "post-process failed; raw result will be returned", e);
            return resultJson;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_OPEN_LOCAL_NLI) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        DevLog.i("MODEL", "model picker returned; resultCode=" + resultCode
                + "; hasUri=" + (data != null && data.getData() != null));
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) return;
        if (!semanticBusy.compareAndSet(false, true)) {
            DevLog.w("MODEL", "model installation rejected because semantic analysis is busy");
            notifyModelError("Дождитесь окончания текущей смысловой проверки");
            return;
        }
        final Uri uri = data.getData();
        final String displayName = readDisplayName(uri);
        DevLog.i("MODEL", "install begin; displayName=" + displayName);
        notifyModelInstalling();
        new Thread(() -> {
            long started = System.currentTimeMillis();
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalArgumentException("Файл модели не открыт");
                String status = localNli.installPackage(in, displayName);
                DevLog.i("MODEL", "install success after " + (System.currentTimeMillis() - started)
                        + "ms; status=" + status);
                notifyModelChanged(status);
            } catch (Exception e) {
                String message = e.getMessage();
                if (message == null || message.trim().isEmpty()) message = e.getClass().getSimpleName();
                DevLog.e("MODEL", "install failed after " + (System.currentTimeMillis() - started) + "ms", e);
                notifyModelError(message);
            } finally {
                semanticBusy.set(false);
            }
        }, "local-nli-install").start();
    }

    String readDevLog() {
        return DevLog.read();
    }

    void clearDevLog() {
        DevLog.clear();
    }

    void logFromJs(String message) {
        DevLog.i("JS", message == null ? "" : message);
    }

    private String readDisplayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int index = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = c.getString(index);
                    if (name != null && !name.trim().isEmpty()) return name.trim();
                }
            }
        } catch (Exception e) {
            DevLog.e("MODEL", "failed to read selected model display name", e);
        }
        String last = uri.getLastPathSegment();
        return last == null || last.trim().isEmpty() ? "semantic-model.zip" : last;
    }

    private void notifyModelInstalling() {
        evaluateSemanticJs("window.onNativeSemanticModelInstalling&&window.onNativeSemanticModelInstalling()");
    }

    private void notifyModelChanged(String statusJson) {
        evaluateSemanticJs("window.onNativeSemanticModelChanged&&window.onNativeSemanticModelChanged(" +
                JSONObject.quote(statusJson == null ? "{}" : statusJson) + ")");
    }

    private void notifyModelError(String message) {
        evaluateSemanticJs("window.onNativeSemanticModelError&&window.onNativeSemanticModelError(" +
                JSONObject.quote(message == null ? "Ошибка смысловой модели" : message) + ")");
    }

    private void notifyAnalysisResult(long requestId, String resultJson) {
        evaluateSemanticJs("window.onNativeSemanticResult&&window.onNativeSemanticResult(" + requestId + "," +
                JSONObject.quote(resultJson == null ? "{}" : resultJson) + ")");
    }

    private void notifyAnalysisError(long requestId, String message) {
        evaluateSemanticJs("window.onNativeSemanticAnalysisError&&window.onNativeSemanticAnalysisError(" + requestId + "," +
                JSONObject.quote(message == null ? "Ошибка смысловой проверки" : message) + ")");
    }

    private void evaluateSemanticJs(String js) {
        runOnUiThread(() -> {
            if (semanticWebView != null) {
                try {
                    semanticWebView.evaluateJavascript(js, null);
                } catch (Throwable e) {
                    DevLog.e("WEB", "evaluateJavascript failed", e);
                }
            } else {
                DevLog.w("WEB", "evaluateJavascript skipped because WebView is null");
            }
        });
    }

    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (!(view instanceof ViewGroup)) return null;
        ViewGroup group = (ViewGroup) view;
        for (int i = 0; i < group.getChildCount(); i++) {
            WebView found = findWebView(group.getChildAt(i));
            if (found != null) return found;
        }
        return null;
    }

    @Override
    protected void onDestroy() {
        DevLog.i("APP", "SemanticActivity.onDestroy; semanticBusy=" + semanticBusy.get());
        if (localNli != null) {
            localNli.requestCancel();
            localNli.close();
            localNli = null;
        }
        semanticWebView = null;
        super.onDestroy();
    }
}
