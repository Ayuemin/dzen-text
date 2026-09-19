package ru.dzenprep.texteditor;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.util.JsonReader;
import android.util.Base64;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.view.ViewTreeObserver;

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.io.InputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Iterator;

public class MainActivity extends Activity implements TextToSpeech.OnInitListener {
    private static final int REQUEST_OPEN_TEXT = 1907;
    private static final int REQUEST_OPEN_DICTIONARY = 1908;
    private static final int REQUEST_SAVE_REPORT = 1909;
    private static final int REQUEST_OPEN_BACKGROUND = 1910;
    private static final int REQUEST_OPEN_FONT = 1911;
    private static final int REQUEST_SAVE_ARTICLE = 1912;
    private static final int MAX_FILE_BYTES = 4 * 1024 * 1024;
    private static final int MAX_DICTIONARY_BYTES = 16 * 1024 * 1024;
    private static final int MAX_FONT_BYTES = 6 * 1024 * 1024;
    private static final String DICT_FILE = "user_synonyms.dat";
    private static final String BACKGROUND_FILE = "editor_background.jpg"; // legacy single background\n    private static final String BACKGROUND_DIR = "editor_backgrounds";\n    private static final String BACKGROUND_ACTIVE_KEY = "background_active_id";
    private static final String FONT_FILE = "editor_font.dat";

    private WebView web;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private volatile String finalUtteranceId = null;
    private final Map<String, List<String>> synonymMap = new HashMap<>(); // внешний пользовательский словарь
    private final Map<String, List<String>> bundledSynonymMap = new HashMap<>(); // встроенный компактный словарь
    private String synonymName = "";
    private int synonymCount = 0;
    private volatile String bundledDictionaryError = "";
    private volatile String pendingReportText = "";
    private volatile String pendingArticleText = "";
    private volatile String pendingArticleFileName = "article.md";
    private DocumentStore documentStore;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        setContentView(web);
        documentStore = new DocumentStore(this);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setTextZoom(100);

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new TtsBridge(), "AndroidTTS");
        web.addJavascriptInterface(new FileBridge(), "AndroidFile");
        web.addJavascriptInterface(new DictionaryBridge(), "AndroidDictionary");
        web.addJavascriptInterface(new SpellBridge(), "AndroidSpell");
        web.addJavascriptInterface(new DocumentsBridge(), "AndroidDocuments");
        installKeyboardObserver();
        loadBundledDictionary();
        loadSavedDictionary();

        tts = new TextToSpeech(this, this);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String utteranceId) { }
            @Override public void onDone(String utteranceId) {
                if (utteranceId != null && utteranceId.equals(finalUtteranceId)) {
                    runJs("window.onNativeTtsDone && window.onNativeTtsDone()");
                }
            }
            @Override public void onError(String utteranceId) {
                runJs("window.onNativeTtsError && window.onNativeTtsError('Ошибка системной озвучки')");
            }
        });

        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS || tts == null) {
            ttsReady = false;
            return;
        }
        int result = tts.setLanguage(new Locale("ru", "RU"));
        if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
            result = tts.setLanguage(Locale.getDefault());
        }
        ttsReady = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED;
    }

    public class TtsBridge {
        @JavascriptInterface
        public boolean isReady() { return ttsReady; }

        @JavascriptInterface
        public void speak(final String text, final float rate) {
            runOnUiThread(() -> {
                if (!ttsReady || tts == null) {
                    runJs("window.onNativeTtsError && window.onNativeTtsError('Системный TTS не готов. Проверьте движок синтеза речи в настройках Android.')");
                    return;
                }
                String clean = text == null ? "" : text.trim();
                if (clean.isEmpty()) return;

                tts.stop();
                tts.setSpeechRate(Math.max(0.5f, Math.min(1.8f, rate)));

                List<String> chunks = splitForTts(clean);
                if (chunks.isEmpty()) return;
                finalUtteranceId = "dzen_" + System.currentTimeMillis() + "_" + (chunks.size() - 1);
                for (int i = 0; i < chunks.size(); i++) {
                    String id = "dzen_" + System.currentTimeMillis() + "_" + i;
                    if (i == chunks.size() - 1) id = finalUtteranceId;
                    tts.speak(chunks.get(i), i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, id);
                }
            });
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(() -> {
                finalUtteranceId = null;
                if (tts != null) tts.stop();
            });
        }
    }

    public class FileBridge {
        @JavascriptInterface
        public void pick() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/plain", "text/markdown", "text/html", "application/xhtml+xml"});
                try {
                    startActivityForResult(intent, REQUEST_OPEN_TEXT);
                } catch (Exception e) {
                    runJs("window.onNativeFileError && window.onNativeFileError('Не удалось открыть выбор файла')");
                }
            });
        }

        @JavascriptInterface
        public void pickBackground() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(intent, REQUEST_OPEN_BACKGROUND);
                } catch (Exception e) {
                    runJs("window.onNativeFileError && window.onNativeFileError('Не удалось открыть выбор изображения')");
                }
            });
        }

        @JavascriptInterface
        public String backgroundData() {
            return backgroundDataFor(activeBackgroundId());
        }

        @JavascriptInterface
        public String backgroundDataById(String id) {
            return backgroundDataFor(id);
        }

        @JavascriptInterface
        public String backgroundList() {
            return backgroundListJson();
        }

        @JavascriptInterface
        public String activeBackgroundId() {
            return MainActivity.this.activeBackgroundId();
        }

        @JavascriptInterface
        public boolean selectBackground(String id) {
            String safe = safeBackgroundId(id);
            File file = backgroundFile(safe);
            if (safe.isEmpty() || !file.exists()) return false;
            setActiveBackgroundId(safe);
            runJs("window.onNativeBackgroundSelected && window.onNativeBackgroundSelected(" + JSONObject.quote(safe) + ")");
            return true;
        }

        @JavascriptInterface
        public boolean deleteBackground(String id) {
            String safe = safeBackgroundId(id);
            if (safe.isEmpty()) return false;
            File file = backgroundFile(safe);
            boolean ok = !file.exists() || file.delete();
            getSharedPreferences("dzen_text", MODE_PRIVATE).edit().remove("background_name_" + safe).apply();
            if (safe.equals(MainActivity.this.activeBackgroundId())) {
                String next = newestBackgroundId();
                setActiveBackgroundId(next);
                runJs("window.onNativeBackgroundSelected && window.onNativeBackgroundSelected(" + JSONObject.quote(next) + ")");
            }
            return ok;
        }

        @JavascriptInterface
        public void clearBackground() {
            String active = MainActivity.this.activeBackgroundId();
            if (!active.isEmpty()) deleteBackground(active);
        }

        @JavascriptInterface
        public void pickFont() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "font/ttf", "font/otf", "font/woff", "font/woff2",
                        "application/x-font-ttf", "application/x-font-opentype",
                        "application/font-woff", "application/octet-stream"
                });
                try {
                    startActivityForResult(intent, REQUEST_OPEN_FONT);
                } catch (Exception e) {
                    runJs("window.onNativeFontError && window.onNativeFontError('Не удалось открыть выбор шрифта')");
                }
            });
        }

        @JavascriptInterface
        public String fontName() {
            return getSharedPreferences("dzen_text", MODE_PRIVATE).getString("font_name", "");
        }

        @JavascriptInterface
        public String fontData() {
            File file = new File(getFilesDir(), FONT_FILE);
            if (!file.exists()) return "";
            String name = fontName().toLowerCase(Locale.ROOT);
            String mime = name.endsWith(".otf") ? "font/otf" :
                    name.endsWith(".woff2") ? "font/woff2" :
                    name.endsWith(".woff") ? "font/woff" : "font/ttf";
            try (FileInputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                return "data:" + mime + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void clearFont() {
            try { new File(getFilesDir(), FONT_FILE).delete(); } catch (Exception ignored) { }
            getSharedPreferences("dzen_text", MODE_PRIVATE).edit().remove("font_name").apply();
            runJs("window.onNativeFontChanged && window.onNativeFontChanged('')");
        }

        @JavascriptInterface
        public void saveReport(final String text, final String fileName) {
            runOnUiThread(() -> {
                pendingReportText = text == null ? "" : text;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_TITLE, (fileName == null || fileName.trim().isEmpty()) ? "Dzen-Text-report.txt" : fileName);
                try {
                    startActivityForResult(intent, REQUEST_SAVE_REPORT);
                } catch (Exception e) {
                    runJs("window.onNativeReportError && window.onNativeReportError('Не удалось открыть сохранение файла')");
                }
            });
        }

        @JavascriptInterface
        public void saveArticleFile(final String text, final String fileName) {
            runOnUiThread(() -> {
                pendingArticleText = text == null ? "" : text;
                pendingArticleFileName = (fileName == null || fileName.trim().isEmpty()) ? "article.md" : fileName.trim();
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("text/markdown");
                intent.putExtra(Intent.EXTRA_TITLE, pendingArticleFileName);
                try {
                    startActivityForResult(intent, REQUEST_SAVE_ARTICLE);
                } catch (Exception e) {
                    runJs("window.onNativeArticleSaveError && window.onNativeArticleSaveError('Не удалось открыть сохранение статьи')");
                }
            });
        }
    }


    public class DocumentsBridge {
        @JavascriptInterface public String ensureActiveArticle() { return documentStore.ensureActiveArticle(); }
        @JavascriptInterface public String createArticle() { return documentStore.createArticle(); }
        @JavascriptInterface public String activeArticleId() { return documentStore.activeArticleId(); }
        @JavascriptInterface public boolean setActiveArticle(String id) { return documentStore.setActiveArticle(id); }
        @JavascriptInterface public boolean saveArticle(String id, String text) { return documentStore.saveArticle(id, text); }
        @JavascriptInterface public String loadArticle(String id) { return documentStore.loadArticle(id); }
        @JavascriptInterface public String listArticles() { return documentStore.listArticlesJson(); }
        @JavascriptInterface public boolean deleteArticle(String id) { return documentStore.deleteArticle(id); }
        @JavascriptInterface public String saveVersion(String articleId, String reason, String text) { return documentStore.saveVersion(articleId, reason, text); }
        @JavascriptInterface public String listVersions(String articleId) { return documentStore.listVersionsJson(articleId); }
        @JavascriptInterface public String loadVersion(String articleId, String versionId) { return documentStore.loadVersion(articleId, versionId); }
        @JavascriptInterface public boolean deleteVersion(String articleId, String versionId) { return documentStore.deleteVersion(articleId, versionId); }
        @JavascriptInterface public int deleteVersionsOlderThan(String articleId, long cutoff) { return documentStore.deleteVersionsOlderThan(articleId, cutoff); }
        @JavascriptInterface public int deleteAllVersions(String articleId) { return documentStore.deleteAllVersions(articleId); }
        @JavascriptInterface public String versionUsage(String articleId) { return documentStore.versionUsageJson(articleId); }
    }

    public class SpellBridge {
        @JavascriptInterface
        public void check(final String text, final String requestId) {
            final String source = text == null ? "" : text;
            final String id = requestId == null ? "" : requestId;
            if (source.trim().isEmpty()) {
                runJs("window.onNativeSpellResult && window.onNativeSpellResult(" + JSONObject.quote(id) + ",[])");
                return;
            }
            new Thread(() -> {
                try {
                    JSONArray result = checkSpellingOnline(source);
                    runJs("window.onNativeSpellResult && window.onNativeSpellResult(" + JSONObject.quote(id) + "," + result.toString() + ")");
                } catch (Exception e) {
                    runJs("window.onNativeSpellError && window.onNativeSpellError(" + JSONObject.quote(id) + ",'Не удалось обратиться к Яндекс.Спеллеру. Проверьте интернет.')");
                }
            }, "dzen-speller").start();
        }
    }

    public class DictionaryBridge {
        @JavascriptInterface
        public void pick() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                try {
                    startActivityForResult(intent, REQUEST_OPEN_DICTIONARY);
                } catch (Exception e) {
                    runJs("window.onNativeDictionaryError && window.onNativeDictionaryError('Не удалось открыть выбор словаря')");
                }
            });
        }

        @JavascriptInterface
        public String lookup(String word) {
            try {
                String key = word == null ? "" : word.trim().toLowerCase(new Locale("ru", "RU"));
                List<String> values = synonymMap.get(key);
                if (values == null || values.isEmpty()) values = bundledSynonymMap.get(key);
                JSONObject out = new JSONObject();
                out.put("word", key);
                JSONArray a = new JSONArray();
                if (values != null) for (String v : values) a.put(v);
                out.put("synonyms", a);
                return out.toString();
            } catch (Exception e) {
                return "{\"synonyms\":[]}";
            }
        }

        @JavascriptInterface
        public String status() {
            try {
                JSONObject out = new JSONObject();
                out.put("name", synonymName);
                out.put("count", synonymCount);
                out.put("builtinCount", bundledSynonymMap.size());
                out.put("builtinError", bundledDictionaryError);
                return out.toString();
            } catch (Exception e) {
                return "{\"count\":0}";
            }
        }

        @JavascriptInterface
        public void clear() {
            synchronized (synonymMap) {
                synonymMap.clear();
                synonymCount = 0;
                synonymName = "";
            }
            try { new File(getFilesDir(), DICT_FILE).delete(); } catch (Exception ignored) { }
            getSharedPreferences("dzen_text", MODE_PRIVATE).edit().remove("dict_name").apply();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null) return;

        if (requestCode == REQUEST_SAVE_REPORT) {
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new Exception("stream");
                out.write(pendingReportText.getBytes(StandardCharsets.UTF_8));
                out.flush();
                runJs("window.onNativeReportSaved && window.onNativeReportSaved('TXT')");
            } catch (Exception e) {
                runJs("window.onNativeReportError && window.onNativeReportError('Не удалось сохранить отчёт')");
            } finally {
                pendingReportText = "";
            }
            return;
        }

        if (requestCode == REQUEST_SAVE_ARTICLE) {
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new Exception("stream");
                out.write(pendingArticleText.getBytes(StandardCharsets.UTF_8));
                out.flush();
                runJs("window.onNativeArticleSaved && window.onNativeArticleSaved(" + JSONObject.quote(pendingArticleFileName) + ")");
            } catch (Exception e) {
                runJs("window.onNativeArticleSaveError && window.onNativeArticleSaveError('Не удалось сохранить статью')");
            } finally {
                pendingArticleText = "";
                pendingArticleFileName = "article.md";
            }
            return;
        }

        if (requestCode == REQUEST_OPEN_BACKGROUND) {
            try {
                String id = saveEditorBackground(uri);
                String name = getSharedPreferences("dzen_text", MODE_PRIVATE).getString("background_name_" + id, "Свой фон");
                runJs("window.onNativeBackgroundAdded && window.onNativeBackgroundAdded(" + JSONObject.quote(id) + "," + JSONObject.quote(name) + ")");
            } catch (Exception e) {
                runJs("window.onNativeFileError && window.onNativeFileError('Не удалось использовать выбранное изображение')");
            }
            return;
        }

        if (requestCode == REQUEST_OPEN_FONT) {
            try {
                String name = readDisplayName(uri);
                String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
                if (!(lower.endsWith(".ttf") || lower.endsWith(".otf") || lower.endsWith(".woff") || lower.endsWith(".woff2"))) {
                    throw new Exception("unsupported font");
                }
                byte[] bytes = readLimited(uri, MAX_FONT_BYTES);
                if (bytes.length < 256) throw new Exception("font too small");
                try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), FONT_FILE))) {
                    out.write(bytes);
                }
                getSharedPreferences("dzen_text", MODE_PRIVATE).edit().putString("font_name", name).apply();
                runJs("window.onNativeFontChanged && window.onNativeFontChanged(" + JSONObject.quote(name) + ")");
            } catch (Exception e) {
                runJs("window.onNativeFontError && window.onNativeFontError('Не удалось подключить шрифт. Поддерживаются TTF, OTF, WOFF и WOFF2 до 6 МБ.')");
            }
            return;
        }

        if (requestCode == REQUEST_OPEN_TEXT) {
            try {
                String name = readDisplayName(uri);
                byte[] bytes = readLimited(uri, MAX_FILE_BYTES);
                String text = decodeText(bytes);
                runJs("window.onNativeFileLoaded && window.onNativeFileLoaded(" + JSONObject.quote(text) + "," + JSONObject.quote(name) + ")");
            } catch (Exception e) {
                runJs("window.onNativeFileError && window.onNativeFileError('Не удалось прочитать файл. Поддерживаются TXT, MD и HTML до 4 МБ.')");
            }
            return;
        }

        if (requestCode == REQUEST_OPEN_DICTIONARY) {
            try {
                String name = readDisplayName(uri);
                byte[] bytes = readLimited(uri, MAX_DICTIONARY_BYTES);
                Map<String, List<String>> parsed = parseDictionaryBytes(bytes);
                if (parsed.isEmpty()) throw new Exception("empty dictionary");
                synchronized (synonymMap) {
                    synonymMap.clear();
                    synonymMap.putAll(parsed);
                    synonymCount = synonymMap.size();
                    synonymName = name;
                }
                try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), DICT_FILE))) { out.write(bytes); }
                getSharedPreferences("dzen_text", MODE_PRIVATE).edit().putString("dict_name", name).apply();
                runJs("window.onNativeDictionaryLoaded && window.onNativeDictionaryLoaded(" + JSONObject.quote(name) + "," + synonymCount + ")");
            } catch (Exception e) {
                runJs("window.onNativeDictionaryError && window.onNativeDictionaryError('Не удалось разобрать словарь. Нужен JSON/TXT до 16 МБ.')");
            }
        }
    }


    private void installKeyboardObserver() {
        final Rect visible = new Rect();
        final float density = getResources().getDisplayMetrics().density;
        final int threshold = Math.round(100f * density);
        web.getViewTreeObserver().addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener() {
            private int lastInset = -1;
            private boolean lastOpen = false;

            @Override
            public void onGlobalLayout() {
                if (web == null) return;
                web.getWindowVisibleDisplayFrame(visible);

                // With adjustResize the WebView itself may shrink, so comparing only
                // rootView.height to the visible frame can report zero. Use the physical
                // display height as a second signal and keep a generous threshold so
                // status/navigation bars are not mistaken for the IME.
                int screenHeight = getResources().getDisplayMetrics().heightPixels;
                int rootHeight = web.getRootView().getHeight();
                int byScreen = Math.max(0, screenHeight - visible.bottom);
                int byRoot = Math.max(0, rootHeight - visible.bottom);
                int inset = Math.max(byScreen, byRoot);

                boolean open = inset > threshold;
                int effective = open ? inset : 0;
                if (effective == lastInset && open == lastOpen) return;
                lastInset = effective;
                lastOpen = open;
                runJs("window.onNativeKeyboardInset && window.onNativeKeyboardInset(" + effective + "," + (open ? "true" : "false") + ")");
            }
        });
    }

    private File backgroundDirectory() {
        File dir = new File(getFilesDir(), BACKGROUND_DIR);
        dir.mkdirs();
        migrateLegacyBackground(dir);
        return dir;
    }

    private void migrateLegacyBackground(File dir) {
        File legacy = new File(getFilesDir(), BACKGROUND_FILE);
        if (!legacy.exists()) return;
        File[] existing = dir.listFiles((d, n) -> n.endsWith(".jpg"));
        if (existing != null && existing.length > 0) {
            legacy.delete();
            return;
        }
        String id = "bg_legacy";
        File target = new File(dir, id + ".jpg");
        boolean moved = legacy.renameTo(target);
        if (!moved) {
            try (FileInputStream in = new FileInputStream(legacy); FileOutputStream out = new FileOutputStream(target)) {
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                moved = true;
            } catch (Exception ignored) { }
            if (moved) legacy.delete();
        }
        if (moved) {
            getSharedPreferences("dzen_text", MODE_PRIVATE).edit()
                    .putString(BACKGROUND_ACTIVE_KEY, id)
                    .putString("background_name_" + id, "Свой фон")
                    .apply();
        }
    }

    private String safeBackgroundId(String raw) {
        String value = raw == null ? "" : raw.trim();
        return value.matches("[A-Za-z0-9_-]{1,96}") ? value : "";
    }

    private File backgroundFile(String id) {
        String safe = safeBackgroundId(id);
        return new File(backgroundDirectory(), safe + ".jpg");
    }

    private String activeBackgroundId() {
        backgroundDirectory();
        String id = safeBackgroundId(getSharedPreferences("dzen_text", MODE_PRIVATE).getString(BACKGROUND_ACTIVE_KEY, ""));
        if (!id.isEmpty() && backgroundFile(id).exists()) return id;
        String next = newestBackgroundId();
        if (!next.isEmpty()) setActiveBackgroundId(next);
        return next;
    }

    private void setActiveBackgroundId(String id) {
        String safe = safeBackgroundId(id);
        SharedPreferences.Editor editor = getSharedPreferences("dzen_text", MODE_PRIVATE).edit();
        if (safe.isEmpty()) editor.remove(BACKGROUND_ACTIVE_KEY); else editor.putString(BACKGROUND_ACTIVE_KEY, safe);
        editor.apply();
    }

    private String newestBackgroundId() {
        File[] files = backgroundDirectory().listFiles((d, n) -> n.endsWith(".jpg"));
        if (files == null || files.length == 0) return "";
        File newest = files[0];
        for (File file : files) if (file.lastModified() > newest.lastModified()) newest = file;
        String name = newest.getName();
        return name.substring(0, name.length() - 4);
    }

    private String backgroundListJson() {
        JSONArray out = new JSONArray();
        File[] files = backgroundDirectory().listFiles((d, n) -> n.endsWith(".jpg"));
        if (files == null) return out.toString();
        List<File> list = new ArrayList<>();
        for (File file : files) list.add(file);
        list.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        String active = activeBackgroundId();
        SharedPreferences prefs = getSharedPreferences("dzen_text", MODE_PRIVATE);
        for (File file : list) {
            try {
                String name = file.getName();
                String id = name.substring(0, name.length() - 4);
                JSONObject item = new JSONObject();
                item.put("id", id);
                item.put("name", prefs.getString("background_name_" + id, "Свой фон"));
                item.put("size", file.length());
                item.put("active", id.equals(active));
                out.put(item);
            } catch (Exception ignored) { }
        }
        return out.toString();
    }

    private String backgroundDataFor(String rawId) {
        String id = safeBackgroundId(rawId);
        if (id.isEmpty()) return "";
        File file = backgroundFile(id);
        if (!file.exists()) return "";
        try (FileInputStream in = new FileInputStream(file); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception e) {
            return "";
        }
    }

    private String saveEditorBackground(Uri uri) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("stream");
            BitmapFactory.decodeStream(in, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new Exception("image");

        int sample = 1;
        while (Math.max(bounds.outWidth / sample, bounds.outHeight / sample) > 2200) sample *= 2;

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap;
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new Exception("stream");
            bitmap = BitmapFactory.decodeStream(in, null, options);
        }
        if (bitmap == null) throw new Exception("decode");

        Bitmap output = bitmap;
        int max = Math.max(bitmap.getWidth(), bitmap.getHeight());
        if (max > 1600) {
            float scale = 1600f / max;
            output = Bitmap.createScaledBitmap(
                    bitmap,
                    Math.max(1, Math.round(bitmap.getWidth() * scale)),
                    Math.max(1, Math.round(bitmap.getHeight() * scale)),
                    true
            );
        }

        String id = "bg_" + System.currentTimeMillis();
        File target = backgroundFile(id);
        try (FileOutputStream out = new FileOutputStream(target)) {
            if (!output.compress(Bitmap.CompressFormat.JPEG, 82, out)) throw new Exception("compress");
        } finally {
            if (output != bitmap) output.recycle();
            bitmap.recycle();
        }

        String name = readDisplayName(uri);
        if (name == null || name.trim().isEmpty()) name = "Свой фон";
        getSharedPreferences("dzen_text", MODE_PRIVATE).edit()
                .putString(BACKGROUND_ACTIVE_KEY, id)
                .putString("background_name_" + id, name)
                .apply();
        return id;
    }

    private void loadSavedDictionary() {
        try {
            File f = new File(getFilesDir(), DICT_FILE);
            if (!f.exists()) return;
            byte[] bytes;
            try (InputStream in = new java.io.FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                bytes = out.toByteArray();
            }
            Map<String, List<String>> parsed = parseDictionaryBytes(bytes);
            synchronized (synonymMap) {
                synonymMap.clear(); synonymMap.putAll(parsed); synonymCount = synonymMap.size();
                synonymName = getSharedPreferences("dzen_text", MODE_PRIVATE).getString("dict_name", "словарь");
            }
        } catch (Exception ignored) { }
    }

    private void loadBundledDictionary() {
        bundledDictionaryError = "";
        try (InputStream in = getAssets().open("synonyms_compact.json")) {
            Map<String, List<String>> parsed = parseCompactStreaming(in);
            synchronized (bundledSynonymMap) {
                bundledSynonymMap.clear();
                bundledSynonymMap.putAll(parsed);
            }
            if (parsed.isEmpty()) bundledDictionaryError = "пустой встроенный словарь";
        } catch (Exception e) {
            bundledDictionaryError = e.getClass().getSimpleName();
        }
    }

    private Map<String, List<String>> parseCompactStreaming(InputStream in) throws Exception {
        Map<String, List<String>> out = new HashMap<>();
        JsonReader reader = new JsonReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        try {
            reader.beginObject();
            while (reader.hasNext()) {
                String name = reader.nextName();
                List<String> vals = new ArrayList<>();
                try {
                    reader.beginArray();
                    while (reader.hasNext()) {
                        try { addSyn(vals, reader.nextString()); }
                        catch (Exception e) { reader.skipValue(); }
                    }
                    reader.endArray();
                } catch (Exception e) {
                    reader.skipValue();
                }
                putSynonyms(out, name, vals);
            }
            reader.endObject();
        } finally {
            try { reader.close(); } catch (Exception ignored) { }
        }
        return out;
    }

    private Map<String, List<String>> parseDictionaryBytes(byte[] bytes) throws Exception {
        if (bytes == null || bytes.length == 0) return new HashMap<>();
        int probeLen = Math.min(bytes.length, 8192);
        String probe = new String(bytes, 0, probeLen, StandardCharsets.UTF_8);
        if (probe.contains("\"wordlist\"")) return parseAbramovStreaming(bytes);
        return parseDictionary(decodeText(bytes));
    }

    private Map<String, List<String>> parseAbramovStreaming(byte[] bytes) throws Exception {
        Map<String, List<String>> out = new HashMap<>();
        JsonReader reader = new JsonReader(new InputStreamReader(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8));
        try {
            reader.beginObject();
            while (reader.hasNext()) {
                String field = reader.nextName();
                if (!"wordlist".equals(field)) { reader.skipValue(); continue; }
                reader.beginArray();
                while (reader.hasNext()) {
                    String name = "";
                    List<String> vals = new ArrayList<>();
                    reader.beginObject();
                    while (reader.hasNext()) {
                        String itemField = reader.nextName();
                        if ("name".equals(itemField)) {
                            name = reader.nextString();
                        } else if ("synonyms".equals(itemField)) {
                            reader.beginArray();
                            while (reader.hasNext()) addSyn(vals, reader.nextString());
                            reader.endArray();
                        } else {
                            reader.skipValue();
                        }
                    }
                    reader.endObject();
                    putSynonyms(out, name, vals);
                }
                reader.endArray();
            }
            reader.endObject();
        } finally {
            try { reader.close(); } catch (Exception ignored) { }
        }
        return out;
    }

    private Map<String, List<String>> parseDictionary(String text) throws Exception {
        Map<String, List<String>> out = new HashMap<>();
        String src = text == null ? "" : text.trim();
        if (src.isEmpty()) return out;
        if (src.startsWith("{")) {
            JSONObject root = new JSONObject(src);
            if (root.has("wordlist") && root.optJSONArray("wordlist") != null) {
                JSONArray list = root.getJSONArray("wordlist");
                for (int i = 0; i < list.length(); i++) {
                    JSONObject item = list.optJSONObject(i);
                    if (item == null) continue;
                    String name = item.optString("name", "").trim();
                    JSONArray syn = item.optJSONArray("synonyms");
                    if (name.isEmpty() || syn == null) continue;
                    List<String> vals = new ArrayList<>();
                    for (int j = 0; j < syn.length(); j++) addSyn(vals, syn.optString(j, ""));
                    putSynonyms(out, name, vals);
                }
            } else {
                Iterator<String> keys = root.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    Object value = root.opt(key);
                    List<String> vals = new ArrayList<>();
                    if (value instanceof JSONArray) {
                        JSONArray a = (JSONArray) value;
                        for (int i = 0; i < a.length(); i++) addSyn(vals, a.optString(i, ""));
                    } else if (value instanceof String) {
                        splitSynonyms(vals, (String) value);
                    } else if (value instanceof JSONObject) {
                        JSONArray a = ((JSONObject) value).optJSONArray("synonyms");
                        if (a != null) for (int i = 0; i < a.length(); i++) addSyn(vals, a.optString(i, ""));
                    }
                    putSynonyms(out, key, vals);
                }
            }
        } else {
            String[] lines = src.split("\\r?\\n");
            for (String line : lines) {
                String t = line.trim();
                if (t.isEmpty() || t.startsWith("#")) continue;
                int pos = t.indexOf('\t');
                if (pos < 0) pos = t.indexOf('=');
                if (pos < 0) pos = t.indexOf(':');
                if (pos <= 0 || pos >= t.length() - 1) continue;
                String key = t.substring(0, pos).trim();
                List<String> vals = new ArrayList<>();
                splitSynonyms(vals, t.substring(pos + 1));
                putSynonyms(out, key, vals);
            }
        }
        return out;
    }

    private void splitSynonyms(List<String> vals, String raw) {
        if (raw == null) return;
        for (String s : raw.split("[|;,]")) addSyn(vals, s);
    }

    private void addSyn(List<String> vals, String value) {
        String v = value == null ? "" : value.trim();
        if (v.isEmpty()) return;
        for (String old : vals) if (old.equalsIgnoreCase(v)) return;
        vals.add(v);
    }

    private void putSynonyms(Map<String, List<String>> out, String key, List<String> vals) {
        String k = key == null ? "" : key.trim().toLowerCase(new Locale("ru", "RU"));
        if (k.isEmpty() || vals == null || vals.isEmpty()) return;
        List<String> current = out.get(k);
        if (current == null) current = new ArrayList<>();
        for (String v : vals) addSyn(current, v);
        if (!current.isEmpty()) out.put(k, current);
    }

    private static class SpellChunk {
        final int start;
        final String text;
        SpellChunk(int start, String text) { this.start = start; this.text = text; }
    }

    private List<SpellChunk> splitForSpeller(String text) {
        final int maxChars = 7000;
        List<SpellChunk> out = new ArrayList<>();
        int start = 0;
        while (start < text.length()) {
            int end = Math.min(text.length(), start + maxChars);
            if (end < text.length()) {
                int best = -1;
                for (int i = end; i > start + maxChars / 2; i--) {
                    char c = text.charAt(i - 1);
                    if (c == '\n' || Character.isWhitespace(c)) { best = i; break; }
                }
                if (best > start) end = best;
            }
            out.add(new SpellChunk(start, text.substring(start, end)));
            start = end;
        }
        return out;
    }

    private JSONArray checkSpellingOnline(String text) throws Exception {
        JSONArray result = new JSONArray();
        for (SpellChunk chunk : splitForSpeller(text)) {
            String body = "text=" + URLEncoder.encode(chunk.text, "UTF-8") + "&lang=ru&options=6&format=plain";
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            HttpURLConnection conn = (HttpURLConnection) new URL("https://speller.yandex.net/services/spellservice.json/checkText").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(18000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "Dzen-Text/1.7.0 Android");
            conn.setFixedLengthStreamingMode(payload.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(payload); }
            int code = conn.getResponseCode();
            InputStream response = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            if (response == null) { conn.disconnect(); throw new Exception("HTTP " + code); }
            byte[] bytes;
            try (InputStream in = response; ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
                byte[] tmp = new byte[4096]; int n;
                while ((n = in.read(tmp)) != -1) buf.write(tmp, 0, n);
                bytes = buf.toByteArray();
            } finally { conn.disconnect(); }
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            JSONArray errors = new JSONArray(new String(bytes, StandardCharsets.UTF_8));
            for (int i = 0; i < errors.length(); i++) {
                JSONObject e = errors.optJSONObject(i);
                if (e == null) continue;
                int pos = e.optInt("pos", -1), len = e.optInt("len", 0);
                if (pos < 0 || len <= 0) continue;
                JSONObject item = new JSONObject();
                item.put("start", chunk.start + pos);
                item.put("end", chunk.start + pos + len);
                item.put("word", e.optString("word", ""));
                item.put("code", e.optInt("code", 0));
                JSONArray suggestions = e.optJSONArray("s");
                item.put("suggestions", suggestions == null ? new JSONArray() : suggestions);
                result.put(item);
            }
        }
        return result;
    }

    private String readDisplayName(Uri uri) {
        String name = "текст.txt";
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) {
                int ix = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (ix >= 0) name = c.getString(ix);
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return name == null ? "текст.txt" : name;
    }

    private byte[] readLimited(Uri uri, int max) throws Exception {
        InputStream in = getContentResolver().openInputStream(uri);
        if (in == null) throw new Exception("stream");
        try (InputStream input = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n, total = 0;
            while ((n = input.read(buf)) != -1) {
                total += n;
                if (total > max) throw new Exception("file too large");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private String decodeText(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xff) == 0xef && (b[1] & 0xff) == 0xbb && (b[2] & 0xff) == 0xbf)
            return new String(b, 3, b.length - 3, StandardCharsets.UTF_8);
        if (b.length >= 2 && (b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xfe)
            return new String(b, 2, b.length - 2, Charset.forName("UTF-16LE"));
        if (b.length >= 2 && (b[0] & 0xff) == 0xfe && (b[1] & 0xff) == 0xff)
            return new String(b, 2, b.length - 2, Charset.forName("UTF-16BE"));
        return new String(b, StandardCharsets.UTF_8);
    }

    private List<String> splitForTts(String text) {
        int hardMax = Math.min(3500, Math.max(500, TextToSpeech.getMaxSpeechInputLength() - 200));
        List<String> parts = new ArrayList<>();
        int start = 0;
        while (start < text.length()) {
            int end = Math.min(text.length(), start + hardMax);
            if (end < text.length()) {
                int best = -1;
                for (int i = end; i > start + hardMax / 2; i--) {
                    char ch = text.charAt(i - 1);
                    if (ch == '.' || ch == '!' || ch == '?' || ch == '…' || ch == '\n') { best = i; break; }
                }
                if (best < 0) {
                    for (int i = end; i > start + hardMax / 2; i--) {
                        if (Character.isWhitespace(text.charAt(i - 1))) { best = i; break; }
                    }
                }
                if (best > start) end = best;
            }
            String part = text.substring(start, end).trim();
            if (!part.isEmpty()) parts.add(part);
            start = end;
            while (start < text.length() && Character.isWhitespace(text.charAt(start))) start++;
        }
        return parts;
    }

    private void runJs(final String js) {
        if (web == null) return;
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return !!(window.handleNativeBack&&window.handleNativeBack())}catch(e){return false}})()",
                result -> {
                    if (!"true".equals(result)) {
                        if (web.canGoBack()) web.goBack();
                        else MainActivity.super.onBackPressed();
                    }
                }
        );
    }

    @Override
    protected void onDestroy() {
        finalUtteranceId = null;
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
