#!/bin/bash
# Gera o pacote para o extensions.gnome.org e para os Releases do GitHub.
# Só entram os arquivos da extensão (sem scripts, README ou arquivos de desenvolvimento).
set -e
cd "$(dirname "$0")"
UUID="$(python3 -c "import json;print(json.load(open('metadata.json'))['uuid'])")"
OUT="$UUID.shell-extension.zip"
rm -f "$OUT"
zip -q -r "$OUT" metadata.json extension.js prefs.js stylesheet.css LICENSE \
    schemas/org.gnome.shell.extensions.cascade-dock.gschema.xml
echo "Pacote gerado: $OUT"
unzip -l "$OUT"
