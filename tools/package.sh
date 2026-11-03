#!/bin/bash
# Zippe le contenu d'extension/ dans dist/wm-doublons-<version>.zip (manifest.json à la racine du zip).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./extension/manifest.json').version")
OUT="$PWD/dist/wm-doublons-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"
(cd extension && zip -X -D -q -r "$OUT" . -x '.*' -x '*/.*' -x '*.DS_Store')
echo "Paquet : $OUT"
