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

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.io.InputStream;
import java.io.File;
import java.io.FileOutputStream;
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
    private static final int MAX_FILE_BYTES = 4 * 1024 * 1024;
    private static final int MAX_DICTIONARY_BYTES = 16 * 1024 * 1024;
    private static final String DICT_FILE = "user_synonyms.dat";

    private WebView web;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private volatile String finalUtteranceId = null;
    private final Map<String, List<String>> synonymMap = new HashMap<>(); // внешний пользовательский словарь
    private final Map<String, List<String>> bundledSynonymMap = new HashMap<>(); // встроенный компактный словарь
    private String synonymName = "";
    private int synonymCount = 0;
    private volatile String bundledDictionaryError = "";

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);

        web = new WebView(this);
        setContentView(web);

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
            conn.setRequestProperty("User-Agent", "Dzen-Text/1.5.0 Android");
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
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        finalUtteranceId = null;
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
