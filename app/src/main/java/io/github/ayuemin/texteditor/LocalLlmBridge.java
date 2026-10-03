package io.github.ayuemin.texteditor;

import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.util.Locale;

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
        String fixedExclusions = exclusions == null ? "" : exclusions;
        // Qwen3 understands /no_think and otherwise tends to spend a large part
        // of the token budget on reasoning before the required JSON. Keep this
        // optimization model-specific so another compatible GGUF stays untouched.
        try {
            JSONObject status = new JSONObject(engine.statusJson());
            String modelName = status.optString("name", "").toLowerCase(Locale.ROOT);
            if (modelName.contains("qwen3")) fixedExclusions += "\n/no_think";
        } catch (Exception ignored) { }
        return activity.startLocalLlmAnalysis(text, criteria, fixedExclusions);
    }
}
