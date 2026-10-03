package io.github.ayuemin.texteditor;

import android.webkit.JavascriptInterface;

final class LocalClassifierBridge {
    private final SemanticActivity activity;
    private final LocalTextClassifier classifier;

    LocalClassifierBridge(SemanticActivity activity, LocalTextClassifier classifier) {
        this.activity = activity;
        this.classifier = classifier;
    }

    @JavascriptInterface
    public String status() {
        return classifier.statusJson();
    }

    @JavascriptInterface
    public String analyze(String text) {
        return classifier.analyzeJson(text);
    }

    @JavascriptInterface
    public void pickPackage() {
        activity.pickLocalClassifierPackage();
    }

    @JavascriptInterface
    public boolean clearUserModel() {
        return classifier.clearUserModel();
    }
}
