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

# versões 1.0 a 1.3 guardavam as configurações num caminho fora do padrão
BAD_SCHEMA_PATH="/org.gnome.shell.extensions.cascade-dock/"
if command -v dconf >/dev/null; then
  BAD_CONF="$(dconf dump "$BAD_SCHEMA_PATH" 2>/dev/null || true)"
  NEW_CONF="$(dconf dump "$SCHEMA_PATH" 2>/dev/null || true)"
  if [ -n "$BAD_CONF" ] && [ -z "$NEW_CONF" ]; then
    printf '%s\n' "$BAD_CONF" | dconf load "$SCHEMA_PATH"
    dconf reset -f "$BAD_SCHEMA_PATH"
    echo "Suas configurações foram mantidas."
  fi
fi

rm -rf "$DEST"
mkdir -p "$DEST"
for f in "${FILES[@]}"; do cp -r "$SRC/$f" "$DEST/"; done
glib-compile-schemas "$DEST/schemas"
# Ativa gravando direto na lista do GNOME. O "gnome-extensions enable" falha
# com extensões recém-instaladas no Wayland (o GNOME só as conhece após o login).
enable_extension() {
  local list
  list="$(gsettings get org.gnome.shell enabled-extensions)"
  if [[ "$list" != *"'$UUID'"* ]]; then
    if [[ "$list" == "@as []" || "$list" == "[]" ]]; then
      list="['$UUID']"
    else
      list="${list%]}, '$UUID']"
    fi
    gsettings set org.gnome.shell enabled-extensions "$list"
  fi
  # garante que as extensões de usuário não estão desligadas em geral
  gsettings set org.gnome.shell disable-user-extensions false
  gnome-extensions enable "$UUID" 2>/dev/null || true
}
if command -v gsettings >/dev/null; then
  enable_extension
  echo "Extensão ativada (vale a partir do próximo login)."
else
  echo "Aviso: não consegui ativar automaticamente. Depois do login, rode:"
  echo "  gnome-extensions enable $UUID"
fi

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
