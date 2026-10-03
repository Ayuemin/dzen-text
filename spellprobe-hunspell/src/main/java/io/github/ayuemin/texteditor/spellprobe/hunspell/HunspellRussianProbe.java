package io.github.ayuemin.texteditor.spellprobe.hunspell;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

final class HunspellRussianProbe implements AutoCloseable {
    static {
        System.loadLibrary("hunspell-probe");
    }

    private long handle;
    private final long initMillis;

    HunspellRussianProbe(Context context) throws IOException {
        long started = System.nanoTime();
        File dir = new File(context.getFilesDir(), "hunspell-probe");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create dictionary directory");
        File aff = new File(dir, "ru_RU.aff");
        File dic = new File(dir, "ru_RU.dic");
        copyAsset(context, "hunspell/ru_RU.aff", aff);
        copyAsset(context, "hunspell/ru_RU.dic", dic);
        handle = nativeCreate(aff.getAbsolutePath(), dic.getAbsolutePath());
        if (handle == 0L) throw new IOException("Native Hunspell returned null handle");
        initMillis = (System.nanoTime() - started) / 1_000_000L;
    }

    long initMillis() { return initMillis; }

    boolean isMisspelled(String word) {
        String value = word == null ? "" : word.trim();
        return !value.isEmpty() && !nativeSpell(handle, value);
    }

    List<String> suggestions(String word, int limit) {
        String value = word == null ? "" : word.trim();
        if (value.isEmpty()) return Collections.emptyList();
        String[] values = nativeSuggest(handle, value, Math.max(1, limit));
        return values == null ? Collections.emptyList() : Arrays.asList(values);
    }

    @Override
    public void close() {
        long value = handle;
        handle = 0L;
        if (value != 0L) nativeDestroy(value);
    }

    private static void copyAsset(Context context, String assetName, File target) throws IOException {
        try (InputStream in = context.getAssets().open(assetName);
             FileOutputStream out = new FileOutputStream(target, false)) {
            byte[] buffer = new byte[32768];
            int n;
            while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
            out.flush();
        }
    }

    private static native long nativeCreate(String affPath, String dicPath);
    private static native void nativeDestroy(long handle);
    /** nativeSpell returns true when Hunspell accepts the word. */
    private static native boolean nativeSpell(long handle, String word);
    private static native String[] nativeSuggest(long handle, String word, int limit);
}
