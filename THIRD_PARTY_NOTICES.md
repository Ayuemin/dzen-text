# Third-party notices

## Russian synonym dictionary

The application bundles a compact derivative of the open-source repository `egorkaru/synonym_dictionary`.

- Repository author/copyright holder: Egor Rudinsky
- License: MIT
- Dictionary content: based on N. Abramov's Russian synonym dictionary

The original repository's MIT license is preserved in `licenses/synonym_dictionary-MIT.txt`.
The bundled runtime file is `app/src/main/assets/synonyms_compact.json`.

## Hunspell spelling engine

The deterministic Russian spelling module uses Hunspell 1.7.2 from upstream commit
`2969be996acad84b91ab3875b1816636fe61a40e`.

Hunspell is upstream tri-licensed. This application uses the **Mozilla Public License 1.1** option for the Hunspell source files. The pinned build preparation step copies the complete upstream `COPYING.MPL` text into the APK as `assets/licenses/hunspell-MPL-1.1.txt`. The project's JNI bridge is maintained separately from the upstream Hunspell source tree.

## LibreOffice Russian Hunspell dictionary

The spelling module bundles `ru_RU.aff` and `ru_RU.dic` from LibreOffice dictionaries commit
`32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4`.

The source dictionary README with its copyright and license notice is preserved in the APK as both `assets/hunspell/README_ru_RU.txt` and `assets/licenses/LibreOffice-ru_RU-README.txt`. The dictionary files are fetched only from the pinned upstream commit during the reproducible build preparation step.
