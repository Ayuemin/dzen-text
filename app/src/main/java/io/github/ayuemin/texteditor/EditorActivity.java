package io.github.ayuemin.texteditor;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Production deterministic editor activity.
 *
 * The normal application path deliberately does not inherit SemanticActivity
 * and therefore does not create LocalNliEngine or attach AndroidSemanticModel.
 * The old NLI implementation remains in the project as an explicit experiment.
 */
public final class EditorActivity extends MainActivity {
    private static final String EDITOR_URL = "file:///android_asset/www/index.html";
    private static final int REQUEST_OPEN_SPELLING_DICTIONARY = 1914;
    private static final int MAX_SPELLING_DICTIONARY_BYTES = 2 * 1024 * 1024;

    private HunspellSpellingBridge spellingBridge;
    private WebView editorWeb;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        DevLog.init(this);
        DevLog.i("APP", "EditorActivity.onCreate; production diagnostics enabled; savedState=" + (state != null));
        WebView web = findWebView(findViewById(android.R.id.content));
        if (web == null) {
            DevLog.e("APP", "WebView not found; production bridges unavailable", null);
            return;
        }
        editorWeb = web;

        // MainActivity starts loading the asset immediately. Stop that queued
        // load, attach all mandatory production bridges, then load the editor
        // once with the deterministic runtime already available to JavaScript.
        web.stopLoading();
        web.addJavascriptInterface(new DocumentRevisionBridge(this), "AndroidDocumentRevision");
        spellingBridge = new HunspellSpellingBridge(this, web);
        web.addJavascriptInterface(spellingBridge, "AndroidSpelling");
        web.addJavascriptInterface(new SpellingFileBridge(), "AndroidSpellingFile");
        web.addJavascriptInterface(new DiagnosticsBridge(), "AndroidDiagnostics");
        spellingBridge.start();
        web.loadUrl(EDITOR_URL);
        DevLog.i("APP", "Deterministic editor loaded with revision + spelling + diagnostics bridges");
    }

    /** Development-only bridge used to retrieve the on-device diagnostic log. */
    public final class DiagnosticsBridge {
        @JavascriptInterface
        public String read() {
            String value = DevLog.read();
            DevLog.i("DIAG", "diagnostic log read by JS; chars=" + value.length());
            return value;
        }

        @JavascriptInterface
        public void clear() {
            DevLog.clear();
        }

        @JavascriptInterface
        public void log(String area, String message) {
            String safeArea = area == null || area.trim().isEmpty() ? "JS" : area.trim();
            DevLog.i(safeArea, message == null ? "" : message);
        }
    }

    public final class SpellingFileBridge {
        @JavascriptInterface
        public void pickImport() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain"});
                try {
                    startActivityForResult(intent, REQUEST_OPEN_SPELLING_DICTIONARY);
                } catch (Exception e) {
                    runSpellingJs("window.onNativeSpellingDictionaryError&&window.onNativeSpellingDictionaryError('Не удалось открыть выбор личного словаря')");
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_OPEN_SPELLING_DICTIONARY) {
            if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
            Uri uri = data.getData();
            try {
                String name = spellingDisplayName(uri);
                String text = readSpellingDictionary(uri);
                runSpellingJs("window.onNativeSpellingDictionaryLoaded&&window.onNativeSpellingDictionaryLoaded(" +
                        JSONObject.quote(text) + "," + JSONObject.quote(name) + ")");
            } catch (Exception e) {
                runSpellingJs("window.onNativeSpellingDictionaryError&&window.onNativeSpellingDictionaryError('Не удалось прочитать личный словарь JSON/TXT до 2 МБ')");
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private String spellingDisplayName(Uri uri) {
        String fallback = "spelling-dictionary.txt";
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String name = cursor.getString(index);
                    if (name != null && !name.trim().isEmpty()) return name.trim();
                }
            }
        } catch (Exception ignored) { }
        return fallback;
    }

    private String readSpellingDictionary(Uri uri) throws Exception {
        try (InputStream in = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new Exception("stream");
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) != -1) {
                if (out.size() + n > MAX_SPELLING_DICTIONARY_BYTES) throw new Exception("too large");
                out.write(buffer, 0, n);
            }
            byte[] bytes = out.toByteArray();
            int offset = bytes.length >= 3 && (bytes[0] & 0xff) == 0xef && (bytes[1] & 0xff) == 0xbb && (bytes[2] & 0xff) == 0xbf ? 3 : 0;
            return new String(bytes, offset, bytes.length - offset, StandardCharsets.UTF_8);
        }
    }

    private void runSpellingJs(String script) {
        WebView web = editorWeb;
        if (web == null) return;
        web.post(() -> {
            if (editorWeb != null) web.evaluateJavascript(script, null);
        });
    }

    private static WebView findWebView(View root) {
        if (root instanceof WebView) return (WebView) root;
        if (!(root instanceof ViewGroup)) return null;
        ViewGroup group = (ViewGroup) root;
        for (int i = 0; i < group.getChildCount(); i++) {
            WebView found = findWebView(group.getChildAt(i));
            if (found != null) return found;
        }
        return null;
    }

    @Override
    protected void onDestroy() {
        DevLog.i("APP", "EditorActivity.onDestroy");
        editorWeb = null;
        if (spellingBridge != null) {
            spellingBridge.close();
            spellingBridge = null;
        }
        super.onDestroy();
    }
}
