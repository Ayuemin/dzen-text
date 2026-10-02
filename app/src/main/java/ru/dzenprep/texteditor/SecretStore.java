package ru.dzenprep.texteditor;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stores the AI API key encrypted at rest.
 *
 * The key never reaches JavaScript: only a presence flag is exposed to the
 * WebView. Encryption uses a non-exportable AES-GCM key held in the Android
 * Keystore, so the ciphertext in SharedPreferences is useless if copied off
 * the device (for example through a cloud backup of the app data).
 *
 * androidx is intentionally not used in this project, so this is implemented
 * directly on the platform Keystore API rather than EncryptedSharedPreferences.
 */
final class SecretStore {
    private static final String PREFS = "dzen_text_private";
    private static final String KEY_ALIAS = "dzen_text_secret";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String PREF_SECRET = "secret_ciphertext";
    private static final String PREF_IV = "secret_iv";

    private final SharedPreferences prefs;

    SecretStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    boolean save(String plainText) {
        String value = plainText == null ? "" : plainText.trim();
        if (value.isEmpty()) return clear();
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey(), new SecureRandom());
            byte[] encrypted = cipher.doFinal(value.getBytes("UTF-8"));
            prefs.edit()
                    .putString(PREF_SECRET, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .putString(PREF_IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    String load() {
        String ciphertext = prefs.getString(PREF_SECRET, "");
        String iv = prefs.getString(PREF_IV, "");
        if (ciphertext == null || ciphertext.isEmpty() || iv == null || iv.isEmpty()) return "";
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey(),
                    new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] plain = cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP));
            return new String(plain, "UTF-8");
        } catch (Exception e) {
            // A rotated or invalidated key must not leave an undecryptable blob behind.
            clear();
            return "";
        }
    }

    boolean has() {
        return !load().isEmpty();
    }

    boolean clear() {
        prefs.edit().remove(PREF_SECRET).remove(PREF_IV).apply();
        return true;
    }
}