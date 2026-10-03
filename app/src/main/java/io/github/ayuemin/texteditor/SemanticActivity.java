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

/** MainActivity plus the optional fully local semantic classifier bridge. */
public class SemanticActivity extends MainActivity {
    private static final int REQUEST_OPEN_LOCAL_CLASSIFIER = 2914;

    private LocalTextClassifier localClassifier;
    private WebView semanticWebView;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        localClassifier = new LocalTextClassifier(this);
        semanticWebView = findWebView(findViewById(android.R.id.content));
        if (semanticWebView != null) {
            semanticWebView.addJavascriptInterface(new LocalClassifierBridge(this, localClassifier), "AndroidLocalClassifier");
            // addJavascriptInterface is guaranteed for the next page load. MainActivity
            // starts loading immediately, so reload once after registration to avoid a
            // race where the first page would not see AndroidLocalClassifier.
            semanticWebView.reload();
        }
    }

    void pickLocalClassifierPackage() {
        runOnUiThread(() -> {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/zip");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/zip", "application/x-zip-compressed", "application/octet-stream"
            });
            try {
                startActivityForResult(intent, REQUEST_OPEN_LOCAL_CLASSIFIER);
            } catch (Exception e) {
                notifyClassifierError("Не удалось открыть выбор пакета модели");
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_OPEN_LOCAL_CLASSIFIER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) return;
        final Uri uri = data.getData();
        final String displayName = readDisplayName(uri);
        notifyClassifierInstalling();
        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalArgumentException("Файл модели не открыт");
                String status = localClassifier.installPackage(in, displayName);
                notifyClassifierChanged(status);
            } catch (Exception e) {
                String message = e.getMessage();
                if (message == null || message.trim().isEmpty()) message = e.getClass().getSimpleName();
                notifyClassifierError(message);
            }
        }, "local-classifier-import").start();
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
        return last == null || last.trim().isEmpty() ? "local-model.zip" : last;
    }

    private void notifyClassifierInstalling() {
        evaluateSemanticJs("window.onNativeLocalClassifierInstalling&&window.onNativeLocalClassifierInstalling()");
    }

    private void notifyClassifierChanged(String statusJson) {
        evaluateSemanticJs("window.onNativeLocalClassifierChanged&&window.onNativeLocalClassifierChanged(" +
                JSONObject.quote(statusJson == null ? "{}" : statusJson) + ")");
    }

    private void notifyClassifierError(String message) {
        evaluateSemanticJs("window.onNativeLocalClassifierError&&window.onNativeLocalClassifierError(" +
                JSONObject.quote(message == null ? "Не удалось установить модель" : message) + ")");
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
        if (localClassifier != null) {
            localClassifier.close();
            localClassifier = null;
        }
        semanticWebView = null;
        super.onDestroy();
    }
}
