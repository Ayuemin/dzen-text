package ru.dzenprep.texteditor;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

public final class DocumentStore {
    private static final long VERSION_LIMIT_BYTES = 100L * 1024L * 1024L;
    private static final String PREFS = "dzen_documents";
    private static final String ACTIVE_KEY = "active_article_id";

    private final File articlesDir;
    private final File versionsDir;
    private final SharedPreferences prefs;

    public DocumentStore(Context context) {
        File root = new File(context.getFilesDir(), "documents");
        articlesDir = new File(root, "articles");
        versionsDir = new File(root, "versions");
        articlesDir.mkdirs();
        versionsDir.mkdirs();
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized String ensureActiveArticle() {
        String id = safeId(prefs.getString(ACTIVE_KEY, ""));
        if (!id.isEmpty() && articleFile(id).exists()) return id;
        return createArticle();
    }

    public synchronized String createArticle() {
        String id = "a_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8);
        try {
            writeUtf8(articleFile(id), "");
            prefs.edit().putString(ACTIVE_KEY, id).apply();
            return id;
        } catch (Exception e) {
            return "";
        }
    }

    public synchronized String activeArticleId() {
        return ensureActiveArticle();
    }

    public synchronized boolean setActiveArticle(String rawId) {
        String id = safeId(rawId);
        if (id.isEmpty() || !articleFile(id).exists()) return false;
        prefs.edit().putString(ACTIVE_KEY, id).apply();
        return true;
    }

    public synchronized boolean saveArticle(String rawId, String text) {
        String id = safeId(rawId);
        if (id.isEmpty()) return false;
        try {
            File file = articleFile(id);
            writeUtf8(file, text == null ? "" : text);
            file.setLastModified(System.currentTimeMillis());
            prefs.edit().putString(ACTIVE_KEY, id).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public synchronized String loadArticle(String rawId) {
        String id = safeId(rawId);
        if (id.isEmpty()) return "";
        try { return readUtf8(articleFile(id)); } catch (Exception e) { return ""; }
    }

    public synchronized String listArticlesJson() {
        JSONArray out = new JSONArray();
        File[] files = articlesDir.listFiles((dir, name) -> name.endsWith(".txt"));
        if (files == null) return out.toString();

        List<File> list = new ArrayList<>();
        Collections.addAll(list, files);
        list.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));

        for (File file : list) {
            try {
                if (file.length() == 0L) continue;
                String name = file.getName();
                String id = name.substring(0, name.length() - 4);
                JSONObject item = new JSONObject();
                item.put("id", id);
                item.put("title", deriveTitle(readPrefix(file, 4096)));
                item.put("updated", file.lastModified());
                item.put("size", file.length());
                out.put(item);
            } catch (Exception ignored) { }
        }
        return out.toString();
    }

    public synchronized boolean deleteArticle(String rawId) {
        String id = safeId(rawId);
        if (id.isEmpty()) return false;
        File article = articleFile(id);
        boolean deleted = !article.exists() || article.delete();
        if (!deleted) return false;
        deleteRecursively(versionDir(id));
        if (id.equals(prefs.getString(ACTIVE_KEY, ""))) prefs.edit().remove(ACTIVE_KEY).apply();
        return true;
    }

    public synchronized String saveVersion(String rawArticleId, String reason, String text) {
        JSONObject result = new JSONObject();
        try {
            String articleId = safeId(rawArticleId);
            String source = text == null ? "" : text;
            if (articleId.isEmpty() || source.trim().isEmpty()) {
                result.put("ok", false);
                result.put("empty", true);
                return result.toString();
            }

            File dir = versionDir(articleId);
            dir.mkdirs();
            byte[] bytes = source.getBytes(StandardCharsets.UTF_8);

            File newest = newestVersionFile(dir);
            if (newest != null && newest.length() == bytes.length) {
                try {
                    if (readUtf8(newest).equals(source)) {
                        result.put("ok", false);
                        result.put("duplicate", true);
                        return result.toString();
                    }
                } catch (Exception ignored) { }
            }

            ensureVersionCapacity(bytes.length);
            long used = versionUsageBytes();
            if (used + bytes.length > VERSION_LIMIT_BYTES) {
                result.put("ok", false);
                result.put("limit", true);
                result.put("used", used);
                result.put("limitBytes", VERSION_LIMIT_BYTES);
                return result.toString();
            }

            long now = System.currentTimeMillis();
            String id = "v_" + now + "_" + UUID.randomUUID().toString().substring(0, 7);
            File textFile = versionTextFile(articleId, id);
            File metaFile = versionMetaFile(articleId, id);
            writeBytes(textFile, bytes);
            writeUtf8(metaFile, sanitizeReason(reason));
            textFile.setLastModified(now);
            metaFile.setLastModified(now);

            result.put("ok", true);
            result.put("id", id);
            result.put("used", versionUsageBytes());
            result.put("limitBytes", VERSION_LIMIT_BYTES);
        } catch (Exception e) {
            try { result.put("ok", false); result.put("error", true); } catch (Exception ignored) { }
        }
        return result.toString();
    }

    public synchronized String listVersionsJson(String rawArticleId) {
        String articleId = safeId(rawArticleId);
        JSONArray versions = new JSONArray();
        File dir = versionDir(articleId);
        File[] files = dir.listFiles((d, name) -> name.endsWith(".txt"));
        if (files != null) {
            List<File> list = new ArrayList<>();
            Collections.addAll(list, files);
            list.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            for (File file : list) {
                try {
                    String name = file.getName();
                    String id = name.substring(0, name.length() - 4);
                    JSONObject item = new JSONObject();
                    item.put("id", id);
                    item.put("ts", file.lastModified());
                    item.put("reason", readMeta(articleId, id));
                    item.put("size", file.length());
                    item.put("preview", compactPreview(readPrefix(file, 520)));
                    versions.put(item);
                } catch (Exception ignored) { }
            }
        }

        JSONObject out = new JSONObject();
        try {
            out.put("versions", versions);
            out.put("articleBytes", directorySize(dir));
            out.put("totalBytes", versionUsageBytes());
            out.put("limitBytes", VERSION_LIMIT_BYTES);
        } catch (Exception ignored) { }
        return out.toString();
    }

    public synchronized String loadVersion(String rawArticleId, String rawVersionId) {
        String articleId = safeId(rawArticleId);
        String versionId = safeId(rawVersionId);
        if (articleId.isEmpty() || versionId.isEmpty()) return "";
        try { return readUtf8(versionTextFile(articleId, versionId)); } catch (Exception e) { return ""; }
    }

    public synchronized boolean deleteVersion(String rawArticleId, String rawVersionId) {
        String articleId = safeId(rawArticleId);
        String versionId = safeId(rawVersionId);
        if (articleId.isEmpty() || versionId.isEmpty()) return false;
        boolean a = deleteIfExists(versionTextFile(articleId, versionId));
        boolean b = deleteIfExists(versionMetaFile(articleId, versionId));
        return a && b;
    }

    public synchronized int deleteVersionsOlderThan(String rawArticleId, long cutoff) {
        String articleId = safeId(rawArticleId);
        if (articleId.isEmpty()) return 0;
        File dir = versionDir(articleId);
        File[] files = dir.listFiles((d, name) -> name.endsWith(".txt"));
        if (files == null) return 0;
        int count = 0;
        for (File file : files) {
            if (file.lastModified() >= cutoff) continue;
            String id = file.getName().substring(0, file.getName().length() - 4);
            if (deleteVersion(articleId, id)) count++;
        }
        return count;
    }

    public synchronized int deleteAllVersions(String rawArticleId) {
        String articleId = safeId(rawArticleId);
        if (articleId.isEmpty()) return 0;
        File dir = versionDir(articleId);
        File[] files = dir.listFiles((d, name) -> name.endsWith(".txt"));
        int count = files == null ? 0 : files.length;
        deleteRecursively(dir);
        return count;
    }

    public synchronized String versionUsageJson(String rawArticleId) {
        JSONObject out = new JSONObject();
        try {
            String articleId = safeId(rawArticleId);
            out.put("articleBytes", directorySize(versionDir(articleId)));
            out.put("totalBytes", versionUsageBytes());
            out.put("limitBytes", VERSION_LIMIT_BYTES);
        } catch (Exception ignored) { }
        return out.toString();
    }

    private void ensureVersionCapacity(long incomingBytes) {
        if (versionUsageBytes() + incomingBytes <= VERSION_LIMIT_BYTES) return;
        List<File> automatic = new ArrayList<>();
        collectAutomaticVersionFiles(versionsDir, automatic);
        automatic.sort(Comparator.comparingLong(File::lastModified));
        for (File textFile : automatic) {
            if (versionUsageBytes() + incomingBytes <= VERSION_LIMIT_BYTES) break;
            File meta = new File(textFile.getParentFile(), textFile.getName().replace(".txt", ".meta"));
            deleteIfExists(textFile);
            deleteIfExists(meta);
        }
    }

    private void collectAutomaticVersionFiles(File dir, List<File> out) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isDirectory()) {
                collectAutomaticVersionFiles(file, out);
            } else if (file.getName().endsWith(".txt")) {
                File meta = new File(file.getParentFile(), file.getName().replace(".txt", ".meta"));
                String reason = "";
                try { reason = readUtf8(meta); } catch (Exception ignored) { }
                if (reason.startsWith("Авто")) out.add(file);
            }
        }
    }

    private File newestVersionFile(File dir) {
        File[] files = dir.listFiles((d, name) -> name.endsWith(".txt"));
        if (files == null || files.length == 0) return null;
        File newest = files[0];
        for (File file : files) if (file.lastModified() > newest.lastModified()) newest = file;
        return newest;
    }

    private String readMeta(String articleId, String versionId) {
        try {
            String value = readUtf8(versionMetaFile(articleId, versionId)).trim();
            return value.isEmpty() ? "Версия" : value;
        } catch (Exception e) {
            return "Версия";
        }
    }

    private String sanitizeReason(String value) {
        String s = value == null ? "Версия" : value.replace("\\n", " ").replace("\\r", " ").trim();
        if (s.isEmpty()) s = "Версия";
        return s.length() > 60 ? s.substring(0, 60) : s;
    }

    private String deriveTitle(String text) {
        if (text == null) return "Без названия";
        String[] lines = text.split("\\r?\\n");
        for (String raw : lines) {
            String line = raw.trim();
            if (line.isEmpty()) continue;
            line = line.replaceFirst("^\\s*(?:#{1,6}|>|[-*+]|\\d+[.)])\\s*", "");
            line = line.replaceAll("\\[([^\\]]+)\\]\\([^)]*\\)", "$1");
            line = line.replaceAll("[*_~`#]", "");
            line = line.replaceAll("\\s+", " ").trim();
            if (line.isEmpty()) continue;
            return line.length() > 72 ? line.substring(0, 72) + "…" : line;
        }
        return "Без названия";
    }

    private String compactPreview(String text) {
        String s = text == null ? "" : text.replaceAll("\\s+", " ").trim();
        if (s.length() > 150) s = s.substring(0, 150) + "…";
        return s;
    }

    private String safeId(String raw) {
        String value = raw == null ? "" : raw.trim();
        return value.matches("[A-Za-z0-9_-]{1,96}") ? value : "";
    }

    private File articleFile(String id) { return new File(articlesDir, id + ".txt"); }
    private File versionDir(String articleId) { return new File(versionsDir, safeId(articleId)); }
    private File versionTextFile(String articleId, String versionId) { return new File(versionDir(articleId), safeId(versionId) + ".txt"); }
    private File versionMetaFile(String articleId, String versionId) { return new File(versionDir(articleId), safeId(versionId) + ".meta"); }

    private long versionUsageBytes() { return directorySize(versionsDir); }

    private long directorySize(File file) {
        if (file == null || !file.exists()) return 0L;
        if (file.isFile()) return file.length();
        long total = 0L;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) total += directorySize(child);
        return total;
    }

    private String readPrefix(File file, int maxBytes) throws Exception {
        if (file == null || !file.exists()) return "";
        try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(file));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int total = 0;
            while (total < maxBytes) {
                int n = in.read(buffer, 0, Math.min(buffer.length, maxBytes - total));
                if (n < 0) break;
                out.write(buffer, 0, n);
                total += n;
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private String readUtf8(File file) throws Exception {
        if (file == null || !file.exists()) return "";
        try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(file));
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void writeUtf8(File file, String text) throws Exception {
        writeBytes(file, (text == null ? "" : text).getBytes(StandardCharsets.UTF_8));
    }

    private void writeBytes(File file, byte[] bytes) throws Exception {
        File parent = file.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new Exception("mkdir");
        File temp = new File(file.getAbsolutePath() + ".tmp");
        File backup = new File(file.getAbsolutePath() + ".bak");

        try (BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(temp))) {
            out.write(bytes);
            out.flush();
        }

        boolean hadOriginal = file.exists();
        if (backup.exists() && !backup.delete()) {
            temp.delete();
            throw new Exception("backup cleanup");
        }

        if (hadOriginal && !file.renameTo(backup)) {
            temp.delete();
            throw new Exception("backup original");
        }

        if (temp.renameTo(file)) {
            if (backup.exists()) backup.delete();
            return;
        }

        if (hadOriginal && backup.exists()) backup.renameTo(file);
        temp.delete();
        throw new Exception("replace");
    }

    private boolean deleteIfExists(File file) { return file == null || !file.exists() || file.delete(); }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }
}
