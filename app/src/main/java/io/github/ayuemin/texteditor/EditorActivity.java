package io.github.ayuemin.texteditor;

import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

/**
 * Production editor activity. SemanticActivity keeps the old NLI path available
 * as an explicit experiment; this subclass adds the deterministic SPELL path.
 */
public final class EditorActivity extends SemanticActivity {
    private HunspellSpellingBridge spellingBridge;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        WebView web = findWebView(findViewById(android.R.id.content));
        if (web == null) {
            DevLog.e("SPELL", "WebView not found; AndroidSpelling bridge unavailable", null);
            return;
        }
        spellingBridge = new HunspellSpellingBridge(this, web);
        web.addJavascriptInterface(spellingBridge, "AndroidSpelling");
        spellingBridge.start();
        DevLog.i("SPELL", "AndroidSpelling bridge attached");
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
