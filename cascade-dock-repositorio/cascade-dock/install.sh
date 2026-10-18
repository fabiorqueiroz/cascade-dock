#!/bin/bash
# Instalador do Cascade Dock (para quem baixa pelo GitHub).
# Pode ser rodado de qualquer pasta: o nome da pasta onde você extraiu
# ou clonou o projeto não importa.
set -e

UUID="cascade-dock@fabiorqueiroz.github.io"
SCHEMA_PATH="/org/gnome/shell/extensions/cascade-dock/"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions"
DEST="$EXT_DIR/$UUID"
SRC="$(cd "$(dirname "$0")" && pwd)"
FILES=(metadata.json extension.js prefs.js stylesheet.css schemas LICENSE)

# versão de testes antiga, chamada MacDock
OLD_UUID="macdock@dash"
OLD_SCHEMA_PATH="/org/gnome/shell/extensions/macdock/"

if [ "$1" = "--uninstall" ]; then
  gnome-extensions disable "$UUID" 2>/dev/null || true
  rm -rf "$DEST"
  echo "Cascade Dock removido. Faça logoff e entre de novo para concluir."
  echo "(Suas configurações ficam guardadas. Para apagá-las também:"
  echo "   dconf reset -f $SCHEMA_PATH )"
  exit 0
fi

# confere se o instalador está junto dos arquivos da extensão
for f in "${FILES[@]}"; do
  if [ ! -e "$SRC/$f" ]; then
    echo "Erro: não encontrei '$f' ao lado do install.sh."
    echo "Rode o install.sh de dentro da pasta que contém extension.js,"
    echo "metadata.json, prefs.js, stylesheet.css e a pasta schemas."
    exit 1
  fi
done

command -v glib-compile-schemas >/dev/null || {
  echo "Erro: glib-compile-schemas não encontrado. Instale com:"
  echo "  sudo apt install libglib2.0-bin"
  exit 1
}

# migra da versão antiga (MacDock), se existir
if [ -d "$EXT_DIR/$OLD_UUID" ]; then
  echo "Encontrei a versão antiga (MacDock). Removendo..."
  gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
  rm -rf "$EXT_DIR/$OLD_UUID"
  if command -v dconf >/dev/null; then
    OLD_CONF="$(dconf dump "$OLD_SCHEMA_PATH" 2>/dev/null || true)"
    NEW_CONF="$(dconf dump "$SCHEMA_PATH" 2>/dev/null || true)"
    if [ -n "$OLD_CONF" ] && [ -z "$NEW_CONF" ]; then
      printf '%s\n' "$OLD_CONF" | dconf load "$SCHEMA_PATH"
      dconf reset -f "$OLD_SCHEMA_PATH"
      echo "Suas configurações do MacDock foram trazidas para o Cascade Dock."
    fi
  fi
fi

rm -rf "$DEST"
mkdir -p "$DEST"
for f in "${FILES[@]}"; do cp -r "$SRC/$f" "$DEST/"; done
glib-compile-schemas "$DEST/schemas"
gnome-extensions enable "$UUID" 2>/dev/null || true

echo "Cascade Dock instalado em $DEST"
echo
echo "Próximos passos:"
echo "  1. Faça LOGOFF e entre de novo (obrigatório no Wayland)."
echo "  2. Se o dock da sua distribuição continuar aparecendo, desative-o no"
echo "     aplicativo Gerenciador de Extensões (no Zorin OS: 'Zorin Dash')."
echo "  3. Configurações:  gnome-extensions prefs $UUID"
echo
echo "Algo deu errado? Veja o log com:"
echo "  journalctl -b -o cat | grep -i -E 'cascade|JS ERROR' | tail -30"
