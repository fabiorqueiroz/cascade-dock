// SPDX-License-Identifier: GPL-2.0-or-later
// Cascade Dock — Copyright (C) 2026 Fábio

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SCHEMA = 'org.gnome.shell.extensions.cascade-dock';

// Cada seção é montada dentro de try/catch: se algo falhar, o erro aparece
// escrito na própria janela (em vez da tela genérica "Ocorreu um erro").
function errorGroup(title, e) {
    const group = new Adw.PreferencesGroup({title: `Erro em: ${title}`});
    group.add(new Gtk.Label({
        label: `${e?.message ?? e}\n\n${e?.stack ?? ''}`,
        wrap: true,
        selectable: true,
        xalign: 0,
    }));
    return group;
}

function makeRow(title, subtitle, widget) {
    const row = new Adw.ActionRow({title, subtitle: subtitle ?? ''});
    widget.valign = Gtk.Align.CENTER;
    row.add_suffix(widget);
    row.activatable_widget = widget;
    return row;
}

function spinRow(settings, key, title, subtitle, lower, upper, step, digits = 0) {
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower, upper,
            step_increment: step,
            page_increment: step * 10,
        }),
        digits,
        numeric: true,
    });
    settings.bind(key, spin, 'value', Gio.SettingsBindFlags.DEFAULT);
    return makeRow(title, subtitle, spin);
}

function switchRow(settings, key, title, subtitle) {
    const sw = new Gtk.Switch();
    settings.bind(key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
    return makeRow(title, subtitle, sw);
}

export default class CascadeDockPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage({
            title: 'Cascade Dock',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);
        try {
            window.set_default_size(600, 800);
        } catch (e) {
            console.error(e);
        }

        let settings;
        try {
            settings = this.getSettings(SCHEMA);
        } catch (e) {
            page.add(errorGroup('carregar configurações', e));
            return;
        }

        const sections = [
            ['Posição', () => {
                const g = new Adw.PreferencesGroup({title: 'Posição'});
                const values = ['top', 'bottom'];
                const dd = Gtk.DropDown.new_from_strings(['Topo', 'Embaixo']);
                dd.selected = Math.max(0, values.indexOf(settings.get_string('position')));
                dd.connect('notify::selected', () =>
                    settings.set_string('position', values[dd.selected]));
                g.add(makeRow('Posição do dock', 'Em qual borda da tela ele fica', dd));
                g.add(spinRow(settings, 'margin', 'Distância da borda', 'Em pixels', 0, 100, 1));
                return g;
            }],

            ['Zoom', () => {
                const g = new Adw.PreferencesGroup({
                    title: 'Zoom em cascata',
                    description: 'Fator 1.0 desliga o zoom.',
                });
                g.add(spinRow(settings, 'zoom-factor', 'Fator de zoom', '2.0 = o ícone dobra de tamanho', 1.0, 3.0, 0.1, 1));
                g.add(spinRow(settings, 'zoom-radius', 'Alcance do zoom', 'Quantos ícones vizinhos são afetados', 0.5, 3.0, 0.1, 1));
                g.add(spinRow(settings, 'follow-speed', 'Suavidade ao seguir o mouse', '0 = instantâneo; maior = mais suave (ms)', 0, 300, 5));
                g.add(spinRow(settings, 'anim-speed', 'Velocidade do zoom', 'Tempo para crescer ao entrar e encolher ao sair (ms)', 0, 1000, 20));
                return g;
            }],

            ['Aparência', () => {
                const g = new Adw.PreferencesGroup({title: 'Aparência'});
                g.add(spinRow(settings, 'icon-size', 'Tamanho dos ícones', 'Em pixels', 24, 128, 2));
                g.add(spinRow(settings, 'spacing', 'Espaço entre ícones', 'Em pixels', 0, 40, 1));
                g.add(spinRow(settings, 'bg-opacity', 'Transparência do fundo', '0 = invisível, 1 = sólido', 0.0, 1.0, 0.05, 2));
                g.add(spinRow(settings, 'corner-radius', 'Arredondamento', 'Em pixels', 0, 60, 1));
                g.add(switchRow(settings, 'show-border', 'Borda sutil', 'Contorno claro ao redor do dock'));
                try {
                    const rgba = new Gdk.RGBA();
                    rgba.parse(settings.get_string('bg-color'));
                    const btn = new Gtk.ColorDialogButton({
                        dialog: new Gtk.ColorDialog(),
                        rgba,
                    });
                    btn.connect('notify::rgba', () => {
                        const c = btn.rgba;
                        const to255 = v => Math.round(v * 255);
                        settings.set_string('bg-color', `rgb(${to255(c.red)},${to255(c.green)},${to255(c.blue)})`);
                    });
                    g.add(makeRow('Cor do fundo', 'A opacidade é ajustada acima', btn));
                } catch (e) {
                    console.error(`Cascade Dock: seletor de cor indisponível: ${e}`);
                }
                return g;
            }],

            ['Indicadores', () => {
                const g = new Adw.PreferencesGroup({title: 'Indicadores e extras'});
                g.add(switchRow(settings, 'show-indicators', 'Bolinha sob apps abertos', null));
                g.add(spinRow(settings, 'indicator-size', 'Tamanho da bolinha', 'Em pixels', 2, 10, 1));
                g.add(switchRow(settings, 'show-running', 'Mostrar apps abertos', 'Inclui apps que não estão fixados'));
                g.add(switchRow(settings, 'show-labels', 'Nome do app ao passar o mouse', null));
                g.add(switchRow(settings, 'bounce', 'Quicar ao abrir um app', 'Como no Mac'));
                return g;
            }],

            ['Prévia', () => {
                const g = new Adw.PreferencesGroup({
                    title: 'Prévia de janelas',
                    description: 'Ao passar o mouse sobre um app aberto. Clique foca a janela; clique do meio fecha.',
                });
                g.add(switchRow(settings, 'show-previews', 'Mostrar miniaturas', null));
                g.add(spinRow(settings, 'preview-delay', 'Atraso para aparecer', '0 = instantâneo (ms)', 0, 2000, 50));
                g.add(spinRow(settings, 'preview-size', 'Tamanho da miniatura', 'Largura máxima, em pixels', 120, 400, 10));
                return g;
            }],

            ['Autohide', () => {
                const g = new Adw.PreferencesGroup({
                    title: 'Esconder automaticamente',
                    description: 'Para mostrar, leve o mouse até a borda da tela onde o dock fica.',
                });
                g.add(switchRow(settings, 'autohide', 'Esconder o dock', null));
                g.add(spinRow(settings, 'hide-delay', 'Atraso para esconder', 'Em milissegundos', 0, 3000, 50));
                g.add(spinRow(settings, 'show-delay', 'Atraso para mostrar', 'Em milissegundos', 0, 2000, 50));
                g.add(spinRow(settings, 'autohide-speed', 'Velocidade da animação', 'Em milissegundos', 0, 1000, 20));
                g.add(spinRow(settings, 'edge-size', 'Faixa de ativação da borda', 'Em pixels', 1, 20, 1));
                g.add(switchRow(settings, 'hide-in-overview', 'Esconder na visão geral', 'Enquanto a tela de Atividades está aberta'));
                return g;
            }],

            ['Sobre', () => {
                const g = new Adw.PreferencesGroup({title: 'Sobre'});
                g.add(new Adw.ActionRow({
                    title: 'Cascade Dock',
                    subtitle: `Criado por Fábio · versão ${this.metadata?.["version-name"] ?? ""}`,
                }));
                const reset = new Gtk.Button({label: 'Restaurar padrões'});
                reset.connect('clicked', () => {
                    for (const key of settings.settings_schema.list_keys())
                        settings.reset(key);
                });
                g.add(makeRow('Restaurar configurações', 'Volta tudo ao padrão', reset));
                return g;
            }],
        ];

        for (const [title, build] of sections) {
            try {
                page.add(build());
            } catch (e) {
                console.error(`Cascade Dock prefs (${title}): ${e}`);
                page.add(errorGroup(title, e));
            }
        }
    }
}
