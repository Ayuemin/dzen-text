package io.github.ayuemin.texteditor;

import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

/**
 * Production deterministic editor activity.
 *
 * The normal application path deliberately does not inherit SemanticActivity
 * and therefore does not create LocalNliEngine or attach AndroidSemanticModel.
 * The old NLI implementation remains in the project as an explicit experiment.
 */
public final class EditorActivity extends MainActivity {
    private static final String EDITOR_URL = "file:///android_asset/www/index.html";
    private HunspellSpellingBridge spellingBridge;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        DevLog.init(this);
        WebView web = findWebView(findViewById(android.R.id.content));
        if (web == null) {
            DevLog.e("APP", "WebView not found; production bridges unavailable", null);
            return;
        }

        // MainActivity starts loading the asset immediately. Stop that queued
        // load, attach all mandatory production bridges, then load the editor
        // once with the deterministic runtime already available to JavaScript.
        web.stopLoading();
        web.addJavascriptInterface(new DocumentRevisionBridge(this), "AndroidDocumentRevision");
        spellingBridge = new HunspellSpellingBridge(this, web);
        web.addJavascriptInterface(spellingBridge, "AndroidSpelling");
        spellingBridge.start();
        web.loadUrl(EDITOR_URL);
        DevLog.i("APP", "Deterministic editor loaded with revision + spelling bridges");
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
        if (spellingBridge != null) {
            spellingBridge.close();
            spellingBridge = null;
        }
        super.onDestroy();
    }
}
