package io.github.ayuemin.texteditor;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Thin owner for the pinned Hunspell 1.7.2 runtime used by the editor.
 *
 * The dictionary is copied once to a versioned app-private directory because
 * Hunspell expects filesystem paths for the .aff/.dic pair. All public methods
 * are synchronized so one engine instance can be safely owned by the spelling
 * worker without accidental concurrent native access.
 */
final class HunspellSpellingEngine implements AutoCloseable {
    static final String ENGINE_VERSION = "1.7.2";
    static final String ENGINE_COMMIT = "2969be996acad84b91ab3875b1816636fe61a40e";
    static final String DICTIONARY_COMMIT = "32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4";
    static final String MODULE_VERSION = "hunspell-1.7.2-lo-32b006a2";

    static {
        System.loadLibrary("hunspell-editor");
    }

    private long handle;
    private final long initMillis;

    HunspellSpellingEngine(Context context) throws IOException {
        long started = System.nanoTime();
        File dir = new File(context.getFilesDir(), "hunspell/" + MODULE_VERSION);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Cannot create Hunspell dictionary directory");
        }
        File aff = new File(dir, "ru_RU.aff");
        File dic = new File(dir, "ru_RU.dic");
        copyAssetOnce(context, "hunspell/ru_RU.aff", aff);
        copyAssetOnce(context, "hunspell/ru_RU.dic", dic);
        handle = nativeCreate(aff.getAbsolutePath(), dic.getAbsolutePath());
        if (handle == 0L) throw new IOException("Native Hunspell returned null handle");
        initMillis = (System.nanoTime() - started) / 1_000_000L;
    }

    long initMillis() {
        return initMillis;
    }

    synchronized boolean isMisspelled(String word) {
        String value = clean(word);
        return handle != 0L && !value.isEmpty() && !nativeSpell(handle, value);
    }

    synchronized List<String> suggestions(String word, int limit) {
        String value = clean(word);
        if (handle == 0L || value.isEmpty()) return Collections.emptyList();
        String[] values = nativeSuggest(handle, value, Math.max(1, Math.min(5, limit)));
        return values == null ? Collections.emptyList() : Arrays.asList(values);
    }

    synchronized void addWord(String word) {
        String value = clean(word);
        if (handle != 0L && !value.isEmpty()) nativeAdd(handle, value);
    }

    @Override
    public synchronized void close() {
        long value = handle;
        handle = 0L;
        if (value != 0L) nativeDestroy(value);
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static void copyAssetOnce(Context context, String assetName, File target) throws IOException {
        if (target.isFile() && target.length() > 0L) return;
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (InputStream in = context.getAssets().open(assetName);
             FileOutputStream out = new FileOutputStream(tmp, false)) {
            byte[] buffer = new byte[32768];
            int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
            out.flush();
        }
        if (target.exists() && !target.delete()) {
            throw new IOException("Cannot replace Hunspell asset " + target.getName());
        }
        if (!tmp.renameTo(target)) {
            throw new IOException("Cannot install Hunspell asset " + target.getName());
        }
    }

    private static native long nativeCreate(String affPath, String dicPath);
    private static native void nativeDestroy(long handle);
    private static native boolean nativeSpell(long handle, String word);
    private static native String[] nativeSuggest(long handle, String word, int limit);
    private static native void nativeAdd(long handle, String word);
}
