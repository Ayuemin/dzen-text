package io.github.ayuemin.texteditor;

import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

/** MainActivity plus the optional fully local semantic classifier bridge. */
public class SemanticActivity extends MainActivity {
    private LocalTextClassifier localClassifier;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        localClassifier = new LocalTextClassifier(this);
        WebView webView = findWebView(findViewById(android.R.id.content));
        if (webView != null) {
            webView.addJavascriptInterface(new LocalClassifierBridge(localClassifier), "AndroidLocalClassifier");
        }
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
        super.onDestroy();
    }
}
