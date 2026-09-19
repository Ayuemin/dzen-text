# Сборка и выпуск APK

## Локальная сборка

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

## GitHub Secrets

Для подписанных GitHub Releases используются:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

Все стабильные обновления должны подписываться тем же ключом, что и v1.3.3+.

## Выпуск стабильной версии

1. Обновить `versionCode` и `versionName` в `app/build.gradle`.
2. Обновить `README.md`, `CHANGELOG.md` и `RELEASE_NOTES.md`.
3. Убедиться, что `versionName` не содержит `-test` или другой prerelease-суффикс.
4. Влить изменения в `main` выпускным commit message:

```text
release: v1.9.0
```

Workflow **Release APK** прочитает `versionName`, соберёт подписанный APK, проверит подпись, создаст тег `v1.9.0` и GitHub Release.

Также сохраняется классический способ: вручную создать и отправить тег `vX.Y.Z`. Workflow проверит, что тег совпадает с `versionName`.

## Проверки перед релизом

`Android CI` выполняет:

- `node --check` для всех JS-файлов;
- `tools/check_editor_invariants.py`;
- `tools/check_app_logic.py`;
- debug и release сборку Android.

Стабильный релиз следует публиковать только после зелёного CI.
