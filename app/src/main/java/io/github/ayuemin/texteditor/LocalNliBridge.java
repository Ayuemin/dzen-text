package io.github.ayuemin.texteditor;

import android.webkit.JavascriptInterface;

final class LocalNliBridge {
    private final SemanticActivity activity;
    private final LocalNliEngine engine;

    LocalNliBridge(SemanticActivity activity, LocalNliEngine engine) {
        this.activity = activity;
        this.engine = engine;
    }

    @JavascriptInterface
    public String status() {
        return engine.statusJson();
    }

    @JavascriptInterface
    public void pickModel() {
        activity.pickLocalNliModel();
    }

    @JavascriptInterface
    public boolean clearModel() {
        return activity.clearLocalNliModel();
    }

    @JavascriptInterface
    public long analyzeAsync(String text, String categoriesJson) {
        return activity.startLocalNliAnalysis(text, categoriesJson);
    }
}
