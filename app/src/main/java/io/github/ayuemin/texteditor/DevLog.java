package io.github.ayuemin.texteditor;

import android.content.Context;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Temporary development log. Remove or disable for production builds. */
final class DevLog {
    private static final String TAG = "TextEditorDev";
    private static final String FILE_NAME = "developer-debug.log";
    private static final String OLD_FILE_NAME = "developer-debug.old.log";
    private static final long MAX_BYTES = 1024L * 1024L;
    private static final int MAX_READ_CHARS = 900_000;
    private static final Object LOCK = new Object();
    private static File file;
    private static File oldFile;

    private DevLog() { }

    static void init(Context context) {
        if (context == null) return;
        synchronized (LOCK) {
            if (file == null) {
                File dir = context.getApplicationContext().getFilesDir();
                file = new File(dir, FILE_NAME);
                oldFile = new File(dir, OLD_FILE_NAME);
            }
        }
    }

    static void i(String area, String message) { write("I", area, message, null); }
    static void w(String area, String message) { write("W", area, message, null); }
    static void e(String area, String message, Throwable error) { write("E", area, message, error); }

    private static void write(String level, String area, String message, Throwable error) {
        String safeArea = clean(area, 40);
        String safeMessage = clean(message, 4000);
        String thread = Thread.currentThread().getName();
        String time = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
        StringBuilder line = new StringBuilder();
        line.append(time).append(' ').append(level).append('/').append(safeArea)
                .append(" [").append(thread).append("] ").append(safeMessage);
        if (error != null) {
            line.append(" | ").append(error.getClass().getSimpleName()).append(": ")
                    .append(clean(error.getMessage(), 1200));
            StackTraceElement[] stack = error.getStackTrace();
            int count = Math.min(10, stack == null ? 0 : stack.length);
            for (int i = 0; i < count; i++) line.append("\n    at ").append(stack[i].toString());
        }
        line.append('\n');

        if ("E".equals(level)) Log.e(TAG, safeArea + ": " + safeMessage, error);
        else if ("W".equals(level)) Log.w(TAG, safeArea + ": " + safeMessage);
        else Log.i(TAG, safeArea + ": " + safeMessage);

        synchronized (LOCK) {
            if (file == null) return;
            try {
                rotateIfNeeded();
                try (FileOutputStream out = new FileOutputStream(file, true)) {
                    out.write(line.toString().getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
            } catch (Exception ignored) { }
        }
    }

    private static void rotateIfNeeded() {
        if (file == null || file.length() < MAX_BYTES) return;
        try { if (oldFile != null && oldFile.exists()) oldFile.delete(); } catch (Exception ignored) { }
        try { file.renameTo(oldFile); } catch (Exception ignored) { }
    }

    static String read() {
        synchronized (LOCK) {
            StringBuilder out = new StringBuilder();
            appendFile(out, oldFile);
            appendFile(out, file);
            if (out.length() > MAX_READ_CHARS) {
                return "… начало журнала обрезано …\n" + out.substring(out.length() - MAX_READ_CHARS);
            }
            return out.toString();
        }
    }

    private static void appendFile(StringBuilder out, File source) {
        if (source == null || !source.isFile()) return;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(source), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line).append('\n');
        } catch (Exception ignored) { }
    }

    static void clear() {
        synchronized (LOCK) {
            try { if (file != null && file.exists()) file.delete(); } catch (Exception ignored) { }
            try { if (oldFile != null && oldFile.exists()) oldFile.delete(); } catch (Exception ignored) { }
        }
        i("LOG", "diagnostic log cleared");
    }

    static String stackSummary(Thread thread) {
        if (thread == null) return "thread=null";
        StringBuilder b = new StringBuilder();
        b.append("thread=").append(thread.getName()).append(" state=").append(thread.getState());
        StackTraceElement[] stack = thread.getStackTrace();
        int count = Math.min(8, stack == null ? 0 : stack.length);
        for (int i = 0; i < count; i++) b.append("\n    at ").append(stack[i].toString());
        Runtime rt = Runtime.getRuntime();
        long used = rt.totalMemory() - rt.freeMemory();
        b.append("\n    memory used=").append(used / (1024 * 1024)).append("MB")
                .append(" total=").append(rt.totalMemory() / (1024 * 1024)).append("MB")
                .append(" max=").append(rt.maxMemory() / (1024 * 1024)).append("MB");
        return b.toString();
    }

    private static String clean(String value, int max) {
        String s = value == null ? "" : value.replace('\u0000', ' ');
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }
}
