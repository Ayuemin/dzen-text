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

/** MainActivity plus a fast fully-local ONNX NLI semantic classifier. */
public class SemanticActivity extends MainActivity {
    private static final int REQUEST_OPEN_LOCAL_NLI = 2916;

    private LocalNliEngine localNli;
    private WebView semanticWebView;
    private final AtomicBoolean semanticBusy = new AtomicBoolean(false);
    private final AtomicLong requestSeq = new AtomicLong(0L);

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        localNli = new LocalNliEngine(this);
        semanticWebView = findWebView(findViewById(android.R.id.content));
        if (semanticWebView != null) {
            semanticWebView.addJavascriptInterface(new LocalNliBridge(this, localNli), "AndroidSemanticModel");
            // MainActivity starts loading before the subclass can attach its bridge.
            // Reload once so the stable editor page always sees AndroidSemanticModel.
            semanticWebView.reload();
        }
    }

    void pickLocalNliModel() {
        runOnUiThread(() -> {
            if (semanticBusy.get()) {
                notifyModelError("Дождитесь окончания текущей смысловой проверки");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/zip");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/zip", "application/octet-stream", "*/*"});
            try {
                startActivityForResult(intent, REQUEST_OPEN_LOCAL_NLI);
            } catch (Exception e) {
                notifyModelError("Не удалось открыть выбор пакета смысловой модели");
            }
        });
    }

    boolean clearLocalNliModel() {
        if (semanticBusy.get() || localNli == null) return false;
        return localNli.clearModel();
    }

    long startLocalNliAnalysis(String text, String categoriesJson) {
        if (localNli == null) return -1L;
        final long requestId = requestSeq.incrementAndGet();
        if (!semanticBusy.compareAndSet(false, true)) {
            notifyAnalysisError(requestId, "Смысловая проверка уже выполняется");
            return -1L;
        }
        new Thread(() -> {
            try {
                String result = localNli.analyzeJson(text, categoriesJson);
                notifyAnalysisResult(requestId, result);
            } catch (Exception e) {
                String message = e.getMessage();
                if (message == null || message.trim().isEmpty()) message = e.getClass().getSimpleName();
                notifyAnalysisError(requestId, message);
            } finally {
                semanticBusy.set(false);
            }
        }, "local-nli-analysis").start();
        return requestId;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_OPEN_LOCAL_NLI) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) return;
        if (!semanticBusy.compareAndSet(false, true)) {
            notifyModelError("Дождитесь окончания текущей смысловой проверки");
            return;
        }
        final Uri uri = data.getData();
        final String displayName = readDisplayName(uri);
        notifyModelInstalling();
        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalArgumentException("Файл модели не открыт");
                String status = localNli.installPackage(in, displayName);
                notifyModelChanged(status);
            } catch (Exception e) {
                String message = e.getMessage();
                if (message == null || message.trim().isEmpty()) message = e.getClass().getSimpleName();
                notifyModelError(message);
            } finally {
                semanticBusy.set(false);
            }
        }, "local-nli-install").start();
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
        if (localNli != null) {
            localNli.close();
            localNli = null;
        }
        semanticWebView = null;
        super.onDestroy();
    }
}
