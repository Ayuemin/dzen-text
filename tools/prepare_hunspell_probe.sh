#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/spellprobe-hunspell/src/main/cpp/vendor/hunspell"
ASSETS="$ROOT/spellprobe-hunspell/src/main/assets/hunspell"
HUNSPELL_COMMIT="2969be996acad84b91ab3875b1816636fe61a40e"
DICT_COMMIT="32b006a2c22a4ac7e8ed3f03346f7b3d85a970a4"

rm -rf "$VENDOR"
mkdir -p "$(dirname "$VENDOR")" "$ASSETS"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git -c advice.detachedHead=false clone --filter=blob:none --no-checkout https://github.com/hunspell/hunspell.git "$TMP/hunspell"
git -C "$TMP/hunspell" fetch --depth=1 origin "$HUNSPELL_COMMIT"
git -C "$TMP/hunspell" checkout --detach FETCH_HEAD
cp -R "$TMP/hunspell/src/hunspell" "$VENDOR"
# Autotools normally generates this header. Android builds the library statically.
sed -e 's/@HAVE_VISIBILITY@/1/g' "$VENDOR/hunvisapi.h.in" > "$VENDOR/hunvisapi.h"

BASE="https://raw.githubusercontent.com/LibreOffice/dictionaries/$DICT_COMMIT/ru_RU"
curl --fail --location --silent --show-error "$BASE/ru_RU.aff" -o "$ASSETS/ru_RU.aff"
curl --fail --location --silent --show-error "$BASE/ru_RU.dic" -o "$ASSETS/ru_RU.dic"
curl --fail --location --silent --show-error "$BASE/README_ru_RU.txt" -o "$ASSETS/README_ru_RU.txt"

printf 'hunspell=%s\ndictionary=%s\n' "$HUNSPELL_COMMIT" "$DICT_COMMIT" > "$ASSETS/PROVENANCE.txt"
echo "Prepared pinned Hunspell $HUNSPELL_COMMIT and ru_RU dictionary $DICT_COMMIT"
