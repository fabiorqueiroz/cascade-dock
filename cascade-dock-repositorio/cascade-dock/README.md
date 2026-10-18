# Cascade Dock

Um dock para GNOME com zoom em cascata que acompanha o mouse, inspirado no comportamento do dock do macOS, mas sem imitar o visual. Os ícones, o tema e o sistema continuam os seus.

Feito para o **Zorin OS**, mas funciona em qualquer distribuição com GNOME Shell 45 ou 46.

<!-- Tire um print do dock com o zoom ativo, salve como docs/screenshot.png e descomente a linha abaixo -->
<!-- ![Cascade Dock em ação](docs/screenshot.png) -->

## O que ele faz

- **Zoom em cascata:** o ícone sob o mouse cresce, os vizinhos crescem um pouco menos e o dock se abre suavemente.
- **Prévia das janelas:** ao passar o mouse sobre um app aberto, aparecem na hora miniaturas ao vivo de cada janela. Clique para focar, clique do meio para fechar.
- **Quique ao abrir um app.**
- **Bolinha** sob os apps abertos.
- **Nome do app** ao passar o mouse.
- **Ocultar automaticamente** (opcional): para mostrar, leve o mouse até a borda da tela.
- **Menu de clique direito:** nova janela, fixar/remover do dock, encerrar.
- **No topo ou embaixo** da tela.
- **Leve:** a animação roda sincronizada com o monitor e para por completo quando o dock está parado.

Quase tudo é configurável: tamanho, zoom, alcance, velocidades, cor, transparência, arredondamento, espaçamento, atrasos e mais.

## Compatibilidade

| Sistema | Situação |
|---|---|
| Zorin OS 18 (GNOME 46) | ✅ Testado |
| GNOME 45 | Deve funcionar (mesma base do 46), mas ainda não foi testado |
| GNOME 47 ou mais novo | Ainda não suportado. [Conte se quiser ajudar a testar](https://github.com/fabiorqueiroz/cascade-dock/issues). |

Para descobrir a sua versão: `gnome-shell --version`.

## Instalação

### Opção 1: pelo site de extensões do GNOME (quando aprovado)

<!-- Depois da aprovação, troque esta seção pelo link da página da extensão em extensions.gnome.org -->
A extensão está em análise no [extensions.gnome.org](https://extensions.gnome.org). Quando for aprovada, a instalação será de um clique.

### Opção 2: pelo pacote do Release

1. Vá em [**Releases**](https://github.com/fabiorqueiroz/cascade-dock/releases) e baixe o arquivo `cascade-dock@fabiorqueiroz.github.io.shell-extension.zip`.
2. No terminal, dentro da pasta onde o arquivo foi baixado:

   ```bash
   gnome-extensions install --force cascade-dock@fabiorqueiroz.github.io.shell-extension.zip
   ```

   > O navegador pode remover o `@` do nome do arquivo baixado. Se isso acontecer, use o nome que aparecer na sua pasta (por exemplo `cascade-dockfabiorqueiroz.github.io.shell-extension.zip`). **Não extraia este zip:** o comando acima instala direto dele.

### Opção 3: pelo código-fonte

```bash
git clone https://github.com/fabiorqueiroz/cascade-dock.git
cd cascade-dock
./install.sh
```

Se o `git` não estiver instalado, use `sudo apt install git`. Outra opção é clicar em **Code → Download ZIP**, extrair e rodar `./install.sh` de dentro da pasta extraída.

> **Sobre o nome da pasta:** o GitHub chama a pasta extraída de `cascade-dock-main`. **Isso não é problema.** Não renomeie nada: o `install.sh` sempre instala no lugar certo. Basta rodá-lo de dentro da pasta onde estão o `extension.js` e o `install.sh`. Se rodar do lugar errado, ele avisa.

### Depois de instalar

1. **Faça logoff e entre de novo.** No Wayland, o GNOME só carrega extensões novas no login.
2. **Ative a extensão,** caso não esteja ativa:

   ```bash
   gnome-extensions enable cascade-dock@fabiorqueiroz.github.io
   ```

3. **Desative o dock original** para não ficar com dois docks. No Zorin OS, abra o aplicativo **Gerenciador de Extensões** e desligue o **Zorin Dash**. Em outras distribuições, desligue o Dash to Dock ou o Ubuntu Dock.
4. **Ajuste ao seu gosto:**

   ```bash
   gnome-extensions prefs cascade-dock@fabiorqueiroz.github.io
   ```

   As configurações também estão no clique direito de qualquer ícone do dock.

## Atualizar

Instale a versão nova pelo mesmo caminho que usou antes e faça logoff e login. Suas configurações são mantidas.

## Desinstalar

```bash
gnome-extensions uninstall cascade-dock@fabiorqueiroz.github.io
```

Se instalou pelo código-fonte, também pode usar `./install.sh --uninstall`. Depois, faça logoff e login e reative o dock original, se quiser.

## Dicas

- **Zoom grudado no cursor:** em *Suavidade ao seguir o mouse*, use `0`.
- **Sem zoom:** em *Fator de zoom*, use `1.0`.
- **Pequeno atraso antes da prévia:** ajuste *Atraso para aparecer* (o padrão é `0`, instantâneo).
- **Para recomeçar:** use **Restaurar padrões**, na seção *Sobre*.

## Problemas

**O dock não aparece.** Confira se a extensão está ativa:

```bash
gnome-extensions info cascade-dock@fabiorqueiroz.github.io
```

**Algo deu errado.** Veja o log e cole o resultado numa [issue](https://github.com/fabiorqueiroz/cascade-dock/issues):

```bash
journalctl -b -o cat | grep -i -E 'cascade|JS ERROR' | tail -30
```

Na issue, informe também a distribuição e a versão do GNOME (`gnome-shell --version`).

## Para desenvolvedores

- `install.sh`: instala direto do código-fonte, sem precisar gerar o pacote.
- `pack.sh`: gera o pacote `cascade-dock@fabiorqueiroz.github.io.shell-extension.zip`, usado no extensions.gnome.org e nos Releases. O pacote leva só os arquivos da extensão.

## Licença

[GPL-2.0-ou-posterior](LICENSE), a mesma licença do GNOME Shell.

Criado por Fábio.

---

## English

**Cascade Dock** is a GNOME Shell dock with mouse-following cascading zoom, live window previews, launch bounce, running indicators and autohide, all highly configurable, while keeping your own icons and theme. Tested on Zorin OS 18 (GNOME 46). Supports GNOME 45 and 46.

**Install from a release:** download `cascade-dock@fabiorqueiroz.github.io.shell-extension.zip` from [Releases](https://github.com/fabiorqueiroz/cascade-dock/releases) and run:

```bash
gnome-extensions install --force cascade-dock@fabiorqueiroz.github.io.shell-extension.zip
```

**Install from source:** `git clone https://github.com/fabiorqueiroz/cascade-dock.git && cd cascade-dock && ./install.sh`

Then log out and back in, enable it with `gnome-extensions enable cascade-dock@fabiorqueiroz.github.io`, disable your distribution's default dock, and configure it with `gnome-extensions prefs cascade-dock@fabiorqueiroz.github.io`.

Licensed under GPL-2.0-or-later.
