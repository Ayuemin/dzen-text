# Сборка и выпуск APK

Нужны Java 17, Android SDK 35 и Gradle 8.10.x.

```bash
gradle :app:assembleDebug
gradle :app:assembleRelease
```

Release-ключ нельзя хранить в репозитории. Проект читает параметры подписи из переменных окружения:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

Для автоматических GitHub Releases добавьте в `Settings → Secrets and variables → Actions`:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

Перед выпуском обновите `versionCode` и `versionName`, затем создайте тег вида `v1.3.3`.
Все обновления установленного приложения должны подписываться тем же release-ключом.
