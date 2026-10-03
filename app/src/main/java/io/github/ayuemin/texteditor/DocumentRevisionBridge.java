package io.github.ayuemin.texteditor;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/**
 * Tiny sidecar store for DOC 01 analysis revisions.
 * It deliberately stores no article text: DocumentStore remains the source of truth.
 */
final class DocumentRevisionBridge {
    private static final String PREFS = "p0_document_revisions";
    private final SharedPreferences prefs;

    DocumentRevisionBridge(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public synchronized String read(String rawId) {
        String id = safeId(rawId);
        JSONObject out = new JSONObject();
        if (id.isEmpty()) return out.toString();
        try {
            out.put("documentId", id);
            out.put("revision", Math.max(0L, prefs.getLong(revKey(id), 0L)));
            out.put("textHash", prefs.getString(hashKey(id), ""));
        } catch (Exception ignored) { }
        return out.toString();
    }

    @JavascriptInterface
    public synchronized String persist(String rawId, long requestedRevision, String rawHash) {
        String id = safeId(rawId);
        String hash = safeHash(rawHash);
        JSONObject out = new JSONObject();
        if (id.isEmpty() || hash.isEmpty()) return out.toString();

        long storedRevision = Math.max(0L, prefs.getLong(revKey(id), 0L));
        String storedHash = prefs.getString(hashKey(id), "");
        long revision = Math.max(1L, requestedRevision);
        if (revision < storedRevision) revision = storedRevision;
        if (!storedHash.isEmpty() && !storedHash.equals(hash) && revision <= storedRevision) {
            revision = storedRevision + 1L;
        }

        // apply() updates SharedPreferences' in-memory state immediately and writes the
        // tiny sidecar asynchronously, avoiding disk I/O on the WebView/UI thread.
        prefs.edit().putLong(revKey(id), revision).putString(hashKey(id), hash).apply();
        try {
            out.put("documentId", id);
            out.put("revision", revision);
            out.put("textHash", hash);
        } catch (Exception ignored) { }
        return out.toString();
    }

    @JavascriptInterface
    public synchronized boolean remove(String rawId) {
        String id = safeId(rawId);
        if (id.isEmpty()) return false;
        prefs.edit().remove(revKey(id)).remove(hashKey(id)).apply();
        return true;
    }

    private static String safeId(String raw) {
        String value = raw == null ? "" : raw.trim();
        return value.matches("[A-Za-z0-9_-]{1,96}") ? value : "";
    }

    private static String safeHash(String raw) {
        String value = raw == null ? "" : raw.trim();
        return value.matches("[A-Fa-f0-9]{8}:[0-9]{1,12}") ? value.toLowerCase() : "";
    }

    private static String revKey(String id) { return "rev:" + id; }
    private static String hashKey(String id) { return "hash:" + id; }
}
