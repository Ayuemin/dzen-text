package io.github.ayuemin.texteditor;

import android.webkit.JavascriptInterface;

final class LocalLlmBridge {
    private final SemanticActivity activity;
    private final LocalLlmEngine engine;

    LocalLlmBridge(SemanticActivity activity, LocalLlmEngine engine) {
        this.activity = activity;
        this.engine = engine;
    }

    @JavascriptInterface
    public String status() {
        return engine.statusJson();
    }

    @JavascriptInterface
    public void pickModel() {
        activity.pickLocalLlmModel();
    }

    @JavascriptInterface
    public boolean clearModel() {
        return activity.clearLocalLlmModel();
    }

    @JavascriptInterface
    public long analyzeAsync(String text, String criteria, String exclusions) {
        // Qwen3 supports /no_think as a soft switch in user/system messages.
        // Keep it native so users can freely edit their visible criteria without
        // accidentally turning long chain-of-thought generation back on.
        String fixedExclusions = (exclusions == null ? "" : exclusions) + "\n/no_think";
        return activity.startLocalLlmAnalysis(text, criteria, fixedExclusions);
    }
}
