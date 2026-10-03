package io.github.ayuemin.texteditor.spellprobe.morfologik;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends Activity {
    private TextView output;
    private Button runButton;
    private Button copyButton;
    private volatile String lastReport = "";

    private static final List<String> CORRECT = Arrays.asList(
            "интересный", "телефон", "телефона", "телефоном", "подъезд", "Россия",
            "компьютер", "редактор", "пользователь", "словарь", "проверка", "орфография",
            "сегодня", "объяснение", "возможность", "длинный", "предложение", "цитата"
    );

    private static final List<String> WRONG = Arrays.asList(
            "интерестный", "превед", "жыраф", "словарьь", "проверрка", "орфаграфия",
            "севодня", "обьяснение", "вазможность", "длиный", "предлажение", "цытата"
    );

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        buildUi();
        runProbe();
    }

    private void buildUi() {
        int pad = (int) (16 * getResources().getDisplayMetrics().density + 0.5f);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Morfologik Russian spelling probe");
        title.setTextSize(20f);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        root.addView(title, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        runButton = new Button(this);
        runButton.setText("Повторить замер");
        runButton.setOnClickListener(v -> runProbe());
        copyButton = new Button(this);
        copyButton.setText("Скопировать отчёт");
        copyButton.setEnabled(false);
        copyButton.setOnClickListener(v -> copyReport());
        actions.addView(runButton, new LinearLayout.LayoutParams(0, -2, 1f));
        actions.addView(copyButton, new LinearLayout.LayoutParams(0, -2, 1f));
        root.addView(actions, new LinearLayout.LayoutParams(-1, -2));

        ScrollView scroll = new ScrollView(this);
        output = new TextView(this);
        output.setText("Запуск…");
        output.setTextSize(13f);
        output.setTypeface(Typeface.MONOSPACE);
        output.setTextIsSelectable(true);
        scroll.addView(output, new ScrollView.LayoutParams(-1, -2));
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(root);
    }

    private void runProbe() {
        runButton.setEnabled(false);
        copyButton.setEnabled(false);
        output.setText("Загрузка словаря и запуск замера…");
        new Thread(() -> {
            String report;
            try {
                report = benchmark();
            } catch (Throwable t) {
                report = "PROBE FAILED\n" + t.getClass().getName() + ": " + String.valueOf(t.getMessage());
                for (StackTraceElement e : t.getStackTrace()) {
                    report += "\n  at " + e;
                    if (report.length() > 12000) break;
                }
            }
            final String finalReport = report;
            runOnUiThread(() -> {
                lastReport = finalReport;
                output.setText(finalReport);
                runButton.setEnabled(true);
                copyButton.setEnabled(true);
            });
        }, "morfologik-probe").start();
    }

    private String benchmark() throws Exception {
        Runtime runtime = Runtime.getRuntime();
        runtime.gc();
        long memBefore = usedMemory(runtime);
        long loadStarted = System.nanoTime();
        MorfologikRussianProbe probe = new MorfologikRussianProbe();
        long loadWall = (System.nanoTime() - loadStarted) / 1_000_000L;
        runtime.gc();
        long memAfter = usedMemory(runtime);

        int correctAccepted = 0;
        int correctRejected = 0;
        StringBuilder details = new StringBuilder();
        details.append("\nCORRECT WORDS\n");
        for (String word : CORRECT) {
            boolean miss = probe.isMisspelled(word);
            if (miss) correctRejected++; else correctAccepted++;
            details.append(miss ? "MISS  " : "OK    ").append(word).append('\n');
        }

        int wrongCaught = 0;
        int wrongMissed = 0;
        details.append("\nMISSPELLINGS\n");
        for (String word : WRONG) {
            boolean miss = probe.isMisspelled(word);
            if (miss) wrongCaught++; else wrongMissed++;
            details.append(miss ? "FOUND " : "LOST  ").append(word);
            if (miss) details.append(" -> ").append(probe.suggestions(word, 5));
            details.append('\n');
        }

        List<String> all = new java.util.ArrayList<>();
        all.addAll(CORRECT);
        all.addAll(WRONG);
        final int rounds = 300;
        final int checks = rounds * all.size();
        // warm-up
        for (int r = 0; r < 20; r++) for (String word : all) probe.isMisspelled(word);
        long started = System.nanoTime();
        int missCount = 0;
        for (int r = 0; r < rounds; r++) {
            for (String word : all) if (probe.isMisspelled(word)) missCount++;
        }
        long elapsedNanos = System.nanoTime() - started;
        double elapsedMs = elapsedNanos / 1_000_000.0;
        double checksPerSecond = checks / Math.max(0.001, elapsedNanos / 1_000_000_000.0);

        File apk = new File(getApplicationInfo().sourceDir);
        StringBuilder out = new StringBuilder();
        out.append("SPELL 01 / candidate A\n");
        out.append("engine: Morfologik 2.2.0\n");
        out.append("dictionary: LanguageTool language-ru 6.8 / ru_RU.dict\n");
        out.append("runtime: Android ").append(Build.VERSION.SDK_INT)
                .append(" / ").append(Build.MODEL).append('\n');
        out.append("abis: ").append(Arrays.toString(Build.SUPPORTED_ABIS)).append('\n');
        out.append("apkBytes: ").append(apk.length()).append('\n');
        out.append("engineInitMs: ").append(probe.initMillis()).append('\n');
        out.append("loadWallMs: ").append(loadWall).append('\n');
        out.append("extraUsedMemoryBytesApprox: ").append(Math.max(0L, memAfter - memBefore)).append('\n');
        out.append("correctAccepted: ").append(correctAccepted).append('/').append(CORRECT.size()).append('\n');
        out.append("correctRejected: ").append(correctRejected).append('\n');
        out.append("wrongCaught: ").append(wrongCaught).append('/').append(WRONG.size()).append('\n');
        out.append("wrongMissed: ").append(wrongMissed).append('\n');
        out.append(String.format(Locale.US, "throughput: %d checks / %.2f ms = %.0f checks/s\n", checks, elapsedMs, checksPerSecond));
        out.append("benchmarkMissCount: ").append(missCount).append('\n');
        out.append(details);
        return out.toString();
    }

    private static long usedMemory(Runtime runtime) {
        return runtime.totalMemory() - runtime.freeMemory();
    }

    private void copyReport() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) return;
        clipboard.setPrimaryClip(ClipData.newPlainText("Morfologik probe", lastReport));
        Toast.makeText(this, "Отчёт скопирован", Toast.LENGTH_SHORT).show();
    }
}
