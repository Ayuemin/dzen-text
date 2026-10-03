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

import org.json.JSONObject;

import java.io.InputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** MainActivity plus an optional fully-local GGUF language-model bridge. */
public class SemanticActivity extends MainActivity {
    private static final int REQUEST_OPEN_LOCAL_LLM = 2915;

    private LocalLlmEngine localLlm;
    private WebView semanticWebView;
    private final AtomicBoolean llmBusy = new AtomicBoolean(false);
    private final AtomicLong llmRequestSeq = new AtomicLong(0L);

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        localLlm = new LocalLlmEngine(this);
        semanticWebView = findWebView(findViewById(android.R.id.content));
        if (semanticWebView != null) {
            semanticWebView.addJavascriptInterface(new LocalLlmBridge(this, localLlm), "AndroidLocalLlm");
            // MainActivity begins loading the page before this subclass can add its
            // bridge. Reload once so the first stable page always sees AndroidLocalLlm.
            semanticWebView.reload();
        }
    }

    void pickLocalLlmModel() {
        runOnUiThread(() -> {
            if (llmBusy.get()) {
                notifyLlmError("Дождитесь окончания текущей смысловой проверки");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/octet-stream", "application/x-gguf", "*/*"
            });
            try {
                startActivityForResult(intent, REQUEST_OPEN_LOCAL_LLM);
            } catch (Exception e) {
                notifyLlmError("Не удалось открыть выбор GGUF-модели");
            }
        });
    }

    boolean clearLocalLlmModel() {
        if (llmBusy.get() || localLlm == null) return false;
        return localLlm.clearModel();
    }

    long startLocalLlmAnalysis(String text, String criteria, String exclusions) {
        if (localLlm == null) return -1L;
        final long requestId = llmRequestSeq.incrementAndGet();
        if (!llmBusy.compareAndSet(false, true)) {
            notifyLlmAnalysisError(requestId, "Смысловая проверка уже выполняется");
            return -1L;
        }
        new Thread(() -> {
            try {
                String result = localLlm.analyzeJson(text, criteria, exclusions);
                notifyLlmAnalysisResult(requestId, result);
            } catch (Exception e) {
                String message = e.getMessage();
                if (message == null || message.trim().isEmpty()) message = e.getClass().getSimpleName();
                notifyLlmAnalysisError(requestId, message);
            } finally {
                llmBusy.set(false);
            }
        }, "local-gguf-analysis").start();
        return requestId;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_OPEN_LOCAL_LLM) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) return;
        if (llmBusy.get()) {
            notifyLlmError("Дождитесь окончания текущей смысловой проверки");
            return;
        }
        final Uri uri = data.getData();
        final String displayName = readDisplayName(uri);
        final long expectedBytes = readSize(uri);
        notifyLlmInstalling();
        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalArgumentException("Файл модели не открыт");
                String status = localLlm.installModel(in, displayName, expectedBytes);
                notifyLlmChanged(status);
            } catch (Exception e) {
                String message = e.getMessage();
                if (message == null || message.trim().isEmpty()) message = e.getClass().getSimpleName();
                notifyLlmError(message);
            }
        }, "local-gguf-install").start();
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
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return last == null || last.trim().isEmpty() ? "model.gguf" : last;
    }

    private long readSize(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int index = c.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !c.isNull(index)) return Math.max(0L, c.getLong(index));
            }
        } catch (Exception ignored) { }
        return -1L;
    }

    private void notifyLlmInstalling() {
        evaluateSemanticJs("window.onNativeLocalLlmInstalling&&window.onNativeLocalLlmInstalling()");
    }

    private void notifyLlmChanged(String statusJson) {
        evaluateSemanticJs("window.onNativeLocalLlmChanged&&window.onNativeLocalLlmChanged(" +
                JSONObject.quote(statusJson == null ? "{}" : statusJson) + ")");
    }

    private void notifyLlmError(String message) {
        evaluateSemanticJs("window.onNativeLocalLlmError&&window.onNativeLocalLlmError(" +
                JSONObject.quote(message == null ? "Ошибка локальной модели" : message) + ")");
    }

    private void notifyLlmAnalysisResult(long requestId, String resultJson) {
        evaluateSemanticJs("window.onNativeLocalLlmResult&&window.onNativeLocalLlmResult(" + requestId + "," +
                JSONObject.quote(resultJson == null ? "{}" : resultJson) + ")");
    }

    private void notifyLlmAnalysisError(long requestId, String message) {
        evaluateSemanticJs("window.onNativeLocalLlmAnalysisError&&window.onNativeLocalLlmAnalysisError(" + requestId + "," +
                JSONObject.quote(message == null ? "Ошибка смысловой проверки" : message) + ")");
    }

    private void evaluateSemanticJs(String js) {
        runOnUiThread(() -> {
            if (semanticWebView != null) semanticWebView.evaluateJavascript(js, null);
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
        if (localLlm != null) {
            localLlm.close();
            localLlm = null;
        }
        semanticWebView = null;
        super.onDestroy();
    }
}
