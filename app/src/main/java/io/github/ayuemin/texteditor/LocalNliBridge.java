package io.github.ayuemin.texteditor;

import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

final class LocalNliBridge {
    private static final String OLD_MEDICAL_SIGNAL = "автор советует самостоятельно увеличить дозировку лекарства";
    private static final String OLD_MEDICAL_SAFE = "автор советует определять дозировку лекарства с врачом";
    private static final String OLD_BYPASS_SIGNAL = "автор предлагает практический способ обойти блокировку, запрет или техническое ограничение";
    private static final String OLD_BYPASS_SAFE = "автор только обсуждает ограничения или предупреждает о последствиях их обхода";

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
        return activity.startLocalNliAnalysis(text, tuneDefaultCategories(categoriesJson));
    }

    @JavascriptInterface
    public boolean cancelAnalysis() {
        return activity.cancelLocalNliAnalysis();
    }

    /**
     * Compatibility migration for the prototype defaults already stored in localStorage.
     * User-written hypotheses are left untouched: a category is changed only when its
     * text still exactly matches the previous built-in default.
     */
    private static String tuneDefaultCategories(String categoriesJson) {
        if (categoriesJson == null || categoriesJson.trim().isEmpty()) return categoriesJson;
        try {
            JSONArray categories = new JSONArray(categoriesJson);
            for (int i = 0; i < categories.length(); i++) {
                JSONObject category = categories.optJSONObject(i);
                if (category == null) continue;
                String id = category.optString("id", "");
                String signal = category.optString("signal", "");
                String safe = category.optString("safe", "");

                if ("medical".equals(id)
                        && OLD_MEDICAL_SIGNAL.equals(signal)
                        && OLD_MEDICAL_SAFE.equals(safe)) {
                    category.put("signal", "человеку советуют без врача увеличить дозу лекарства или принять в два раза больше препарата");
                    category.put("safe", "человеку советуют не менять дозировку самостоятельно и обратиться к врачу");
                    category.put("threshold", 0.50d);
                } else if ("bypass".equals(id)
                        && OLD_BYPASS_SIGNAL.equals(signal)
                        && OLD_BYPASS_SAFE.equals(safe)) {
                    category.put("signal", "автор объясняет конкретный технический способ обойти интернет-блокировку, запрет доступа к сайту или сетевое ограничение");
                    category.put("safe", "текст не предлагает способ обхода технической или интернет-блокировки и только обсуждает ограничения");
                    category.put("threshold", 0.72d);
                }
            }
            return categories.toString();
        } catch (Exception ignored) {
            return categoriesJson;
        }
    }
}
