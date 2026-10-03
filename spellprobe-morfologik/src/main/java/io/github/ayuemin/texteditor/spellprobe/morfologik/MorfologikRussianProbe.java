package io.github.ayuemin.texteditor.spellprobe.morfologik;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import morfologik.speller.Speller;
import morfologik.stemming.Dictionary;

/** Small experiment wrapper. It deliberately has no dependency on LanguageTool runtime classes. */
final class MorfologikRussianProbe {
    private static final String DICT = "org/languagetool/resource/ru/hunspell/ru_RU.dict";
    private static final String INFO = "org/languagetool/resource/ru/hunspell/ru_RU.info";

    private final Speller speller;
    private final long initMillis;

    MorfologikRussianProbe() throws IOException {
        long started = System.nanoTime();
        ClassLoader loader = MorfologikRussianProbe.class.getClassLoader();
        if (loader == null) throw new IOException("ClassLoader unavailable");
        try (InputStream dict = loader.getResourceAsStream(DICT);
             InputStream info = loader.getResourceAsStream(INFO)) {
            if (dict == null) throw new IOException("Missing resource: " + DICT);
            if (info == null) throw new IOException("Missing resource: " + INFO);
            this.speller = new Speller(Dictionary.read(dict, info));
        }
        initMillis = (System.nanoTime() - started) / 1_000_000L;
    }

    long initMillis() {
        return initMillis;
    }

    boolean isMisspelled(String word) {
        String value = word == null ? "" : word.trim();
        return !value.isEmpty() && speller.isMisspelled(value);
    }

    List<String> suggestions(String word, int limit) {
        String value = word == null ? "" : word.trim();
        if (value.isEmpty()) return Collections.emptyList();
        List<String> raw = speller.findReplacements(value);
        if (raw == null || raw.isEmpty()) return Collections.emptyList();
        int n = Math.max(0, Math.min(Math.max(1, limit), raw.size()));
        return new ArrayList<>(raw.subList(0, n));
    }
}
