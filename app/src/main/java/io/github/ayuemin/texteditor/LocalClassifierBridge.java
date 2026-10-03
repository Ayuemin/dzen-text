package io.github.ayuemin.texteditor;

import android.webkit.JavascriptInterface;

final class LocalClassifierBridge {
    private final LocalTextClassifier classifier;

    LocalClassifierBridge(LocalTextClassifier classifier) {
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
}
