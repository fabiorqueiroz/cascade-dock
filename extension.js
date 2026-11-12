// SPDX-License-Identifier: GPL-2.0-or-later
// Cascade Dock — Copyright (C) 2026 Fábio

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SCHEMA = 'org.gnome.shell.extensions.cascade-dock';
const PAD_X = 14;
const PAD_Y = 12;
const POLL_MS = 80;
const DRAG_THRESHOLD = 8;      // px de movimento para virar arrasto
const SLIDE_MS = 180;           // tempo para os vizinhos deslizarem
const AM = Clutter.AnimationMode;

export default class CascadeDockExtension extends Extension {
    // ------------------------------------------------------------------
    // Ciclo de vida
    // ------------------------------------------------------------------
    enable() {
        this._settings = this.getSettings(SCHEMA);
        this._items = [];
        this._conns = [];
        this._timers = {};
        this._pollId = 0;
        this._bouncing = new Map();
        this._hoverIdx = -1;
        this._widths = [];
        this._centers = [];
        this._overviewHidden = false;
        this._previewWanted = false;
        this._hidden = this._settings.get_string('hide-mode') === 'always';
        this._overlap = false;
        this._wt = null;

        this._favs = AppFavorites.getAppFavorites();
        this._appSys = Shell.AppSystem.get_default();

        this._connect(this._settings, 'changed', () => this._setTimer('rebuild', 150, () => this._build()));
        this._connect(this._favs, 'changed', () => this._queueSync());
        this._connect(this._appSys, 'app-state-changed', () => this._queueSync());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._setTimer('rebuild', 150, () => this._build()));
        this._connect(Main.overview, 'showing', () => this._setOverview(true));
        this._connect(Main.overview, 'hiding', () => this._setOverview(false));

        this._build();
    }

    disable() {
        for (const name of Object.keys(this._timers ?? {}))
            this._clearTimer(name);
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        for (const [obj, id] of this._conns ?? [])
            obj.disconnect(id);
        this._conns = null;
        this._stopTracking();
        this._destroyDock();
        this._bouncing = null;
        this._settings = null;
        this._favs = null;
        this._appSys = null;
    }

    // ------------------------------------------------------------------
    // Utilitários
    // ------------------------------------------------------------------
    _connect(obj, signal, fn) {
        this._conns.push([obj, obj.connect(signal, fn)]);
    }

    _setTimer(name, ms, fn) {
        this._clearTimer(name);
        this._timers[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timers[name] = 0;
            fn();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTimer(name) {
        if (this._timers?.[name]) {
            GLib.source_remove(this._timers[name]);
            this._timers[name] = 0;
        }
    }

    _getApps() {
        const apps = [...this._favs.getFavorites()];
        if (this._settings.get_boolean('show-running')) {
            for (const app of this._appSys.get_running()) {
                if (!apps.includes(app))
                    apps.push(app);
            }
        }
        return apps;
    }

    _queueSync() {
        this._setTimer('sync', 120, () => this._sync());
    }

    // Só reconstrói se a lista de apps mudou; senão apenas atualiza as bolinhas.
    _sync() {
        if (!this._root) {
            this._build();
            return;
        }
        const ids = this._getApps().map(a => a.get_id());
        const cur = this._items.map(i => i.id);
        const same = list => ids.length === list.length && ids.every((v, k) => v === list[k]);
        if (same(cur)) {
            this._updateDots();
        } else if (!this._drag && same(this._order.map(i => cur[i]))) {
            this._adoptOrder();
            this._updateDots();
        } else {
            this._build();
        }
    }

    _updateDots() {
        for (const it of this._items) {
            it.dot.visible = this._g.showInd && it.app.state === Shell.AppState.RUNNING;
        }
    }

    _destroyDock() {
        this._press = null;
        this._drag = null;
        this._closeMenu();
        // invalida quiques em andamento: callbacks pendentes não tocam atores destruídos
        for (const st of this._bouncing?.values() ?? [])
            st.gen++;
        this._clearTimer('hide');
        this._clearTimer('preview');
        this._clearTimer('phide');
        this._previewWanted = false;
        if (this._preview) {
            Main.layoutManager.removeChrome(this._preview);
            this._preview.destroy();
            this._preview = null;
        }
        this._menuManager = null;
        if (this._tl) {
            this._tl.stop();
            this._tl = null;
        }
        if (this._root) {
            Main.layoutManager.removeChrome(this._root);
            this._root.destroy();
        }
        this._root = null;
        this._bg = null;
        this._label = null;
        this._items = [];
        this._hoverIdx = -1;
    }

    // ------------------------------------------------------------------
    // Construção
    // ------------------------------------------------------------------
    _build() {
        this._destroyDock();

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const s = this._settings;
        const apps = this._getApps();
        const n = apps.length;
        if (n === 0)
            return;

        const S = s.get_int('icon-size');
        const Z = s.get_double('zoom-factor');
        const spacing = s.get_int('spacing');
        const radius = s.get_double('zoom-radius');
        const atTop = s.get_string('position') === 'top';
        const M = Math.round(S * Z);                     // tamanho máximo (ícone nítido)
        const baseTotal = n * S + (n - 1) * spacing + 2 * PAD_X;
        const extra = (Z - 1) * S * (2.6 * radius + 1);
        const rootW = Math.min(monitor.width, Math.ceil(baseTotal + extra + 2 * PAD_X));
        const rootH = M + 2 * PAD_Y;

        const g = this._g = {
            S, Z, M, n, spacing, atTop, rootW, rootH, baseTotal,
            bgH: S + 2 * PAD_Y,
            sigma: radius * (S + spacing),
            followMs: s.get_int('follow-speed'),
            easeMs: s.get_int('anim-speed'),
            showInd: s.get_boolean('show-indicators'),
            indSize: s.get_int('indicator-size'),
            labels: s.get_boolean('show-labels'),
            bounce: s.get_boolean('bounce'),
            hideMode: s.get_string('hide-mode'),       // never | smart | always
            hideDelay: s.get_int('hide-delay'),
            showDelay: s.get_int('show-delay'),
            hideMs: s.get_int('autohide-speed'),
            edge: s.get_int('edge-size'),
            hideInOverview: s.get_boolean('hide-in-overview'),
            previews: s.get_boolean('show-previews'),
            dragRemove: s.get_boolean('drag-to-remove'),
            previewDelay: s.get_int('preview-delay'),
            previewSize: s.get_int('preview-size'),
            iconY: atTop ? PAD_Y : rootH - PAD_Y - M,
            monY: monitor.y,
            monH: monitor.height,
        };

        // posição na tela
        const margin = s.get_int('margin');
        const panelBox = Main.layoutManager.panelBox;
        const panelH = panelBox.y <= monitor.y + 1 ? panelBox.height : 0;
        g.rootX = monitor.x + Math.round((monitor.width - rootW) / 2);
        g.rootY = atTop
            ? monitor.y + panelH + margin
            : monitor.y + monitor.height - rootH - margin;
        g.hideShift = atTop
            ? -(g.rootY - monitor.y + rootH)
            : (monitor.y + monitor.height - g.rootY);

        // atores
        this._root = new Clutter.Actor({reactive: true});
        this._root.set_size(rootW, rootH);

        const [cr, cg, cb] = (s.get_string('bg-color').match(/\d+/g) ?? ['24', '24', '28'])
            .slice(0, 3).map(Number);
        const border = s.get_boolean('show-border') ? 'border: 1px solid rgba(255, 255, 255, 0.14);' : '';
        this._bg = new St.Widget({
            style: `background-color: rgba(${cr}, ${cg}, ${cb}, ${s.get_double('bg-opacity')}); ` +
                   `border-radius: ${s.get_int('corner-radius')}px; ${border}`,
        });
        this._root.add_child(this._bg);

        const ds = g.indSize;
        g.dotY = atTop
            ? Math.round((PAD_Y - ds) / 2)
            : rootH - PAD_Y + Math.round((PAD_Y - ds) / 2);

        apps.forEach((app, i) => {
            const btn = new St.Button({
                reactive: true,
                can_focus: true,
                track_hover: true,
                button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            });
            btn.set_child(app.create_icon_texture(M));
            btn.set_size(M, M);
            btn.set_pivot_point(0.5, atTop ? 0 : 1);
            btn.set_scale(1 / Z, 1 / Z);
            btn.set_position(0, g.iconY);
            btn.connect('clicked', (_b, button) => this._onClick(app, btn, button));
            btn.connect('button-press-event', (_b, event) => this._onPress(btn, event));
            this._root.add_child(btn);

            const dot = new St.Widget({
                style: `background-color: rgba(255, 255, 255, 0.9); border-radius: ${ds}px;`,
                reactive: false,
                visible: false,
            });
            dot.set_size(ds, ds);
            dot.set_position(0, g.dotY);
            this._root.add_child(dot);

            this._items.push({app, id: app.get_id(), btn, dot});
        });

        this._label = new St.Label({
            style: 'background-color: rgba(30, 30, 34, 0.92); color: white; ' +
                   'border-radius: 8px; padding: 3px 10px; font-size: 10.5pt;',
            reactive: false,
            visible: false,
            opacity: 0,
        });
        this._root.add_child(this._label);
        this._buildPreview(cr, cg, cb, s.get_double('bg-opacity'));

        this._root.connect('motion-event', (_a, e) => this._onMotion(e));
        this._root.connect('enter-event', (_a, e) => {
            this._clearTimer('hide');
            return this._onMotion(e);
        });
        this._root.connect('leave-event', () => this._onLeave());
        // o LayoutManager pode reexibir o ator (fullscreen/overview): respeitamos o estado
        this._root.connect('notify::visible', () => {
            if (this._root?.visible && !this._isShown())
                this._root.hide();
        });

        this._root.set_position(g.rootX, g.rootY);

        const bx0 = (rootW - g.baseTotal) / 2;
        g.base = apps.map((_a, i) => bx0 + PAD_X + i * (S + spacing) + S / 2);
        this._widths = new Array(n).fill(S);
        this._centers = new Array(n).fill(0);
        this._order = apps.map((_a, i) => i);      // ordem de exibição (slot -> item)
        this._slide = new Array(n).fill(0);        // deslocamento animado de cada item
        this._px = this._tpx = rootW / 2;
        this._amt = this._tamt = 0;
        this._bgX = this._bgW = -1;
        this._apply(this._px, 0);

        this._tl = new Clutter.Timeline({actor: this._root, duration: 1000, repeat_count: -1});
        this._tl.connect('new-frame', () => this._tick());
        Main.layoutManager.addChrome(this._root, {trackFullscreen: true});

        this._menuManager = new PopupMenu.PopupMenuManager(this._root);
        this._updateDots();
        this._applyVisibility(false);

        if (g.hideMode === 'smart') {
            this._startTracking();
            this._overlap = this._computeOverlap();
            this._hidden = this._overlap && !this._pointerInDock();
            this._applyVisibility(false);
            if (this._hidden)
                this._startPoll();
        } else {
            this._stopTracking();
            if (g.hideMode === 'never')
                this._hidden = false;
            this._applyVisibility(false);
            if (g.hideMode === 'always') {
                if (this._hidden)
                    this._startPoll();
                else
                    this._scheduleHide();
            }
        }

        // retoma quiques em andamento (a reconstrução recriou os ícones)
        for (const [id, st] of this._bouncing) {
            st.gen++;
            this._bounceStep(id, st.gen);
        }
    }

    // ------------------------------------------------------------------
    // Layout / magnificação
    // ------------------------------------------------------------------
    // O mouse só registra o alvo (_tpx/_tamt). Um único laço por quadro
    // (Clutter.Timeline, sincronizado com o monitor) suaviza e aplica tudo
    // diretamente, sem criar animações a cada evento do mouse.

    // px = X do mouse relativo ao dock; amt = intensidade do zoom (0..1)
    _apply(px, amt) {
        const g = this._g;
        const widths = this._widths;
        let total = (g.n - 1) * g.spacing + 2 * PAD_X;
        const k = (g.Z - 1) * amt;
        const inv = 1 / (2 * g.sigma * g.sigma);
        const order = this._order;
        for (let s = 0; s < g.n; s++) {
            let w = g.S;
            if (k > 0) {
                const d = px - g.base[s];
                w = g.S * (1 + k * Math.exp(-d * d * inv));     // curva gaussiana
            }
            widths[order[s]] = w;
            total += w;
        }

        const drag = this._drag;
        const startX = (g.rootW - total) / 2;
        let left = startX + PAD_X;
        for (let s = 0; s < g.n; s++) {
            const i = order[s];
            const it = this._items[i];
            const w = widths[i];
            const cx = left + w / 2;
            this._centers[i] = cx;
            const sc = w / g.M;
            // o ícone arrastado segue o ponteiro; os outros vão ao seu lugar (com deslize)
            const x = drag?.i === i ? drag.x : cx + this._slide[i];
            it.btn.translation_x = x - g.M / 2;
            it.btn.set_scale(sc, sc);
            it.dot.translation_x = Math.round(x - g.indSize / 2);
            left += w + g.spacing;
        }

        // fundo: só mexe quando muda de fato (evita relayout desnecessário)
        const bx = Math.round(startX);
        const bw = Math.round(total);
        if (bx !== this._bgX || bw !== this._bgW) {
            this._bgX = bx;
            this._bgW = bw;
            this._bg.set_position(bx, g.atTop ? 0 : g.rootH - g.bgH);
            this._bg.set_size(bw, g.bgH);
        }

        this._placeLabel();
        if (this._previewWanted && this._previewIdx >= 0)
            this._preview.x = this._previewX();
    }

    // Rede de segurança: se o mouse saiu do dock sem o GNOME avisar
    // (leave-event perdido), desfaz o zoom. Só roda com o dock ampliado e parado.
    _armZoomWatch() {
        this._setTimer('zoomWatch', 250, () => {
            if (!this._root || this._tamt !== 1 || this._drag || this._press)
                return;
            if (this._pointerInDock())
                this._armZoomWatch();
            else
                this._onLeave();
        });
    }

    _kick() {
        if (!this._tl || this._tl.is_playing())
            return;
        this._lastFrame = GLib.get_monotonic_time();
        this._tl.start();
    }

    _tick() {
        const g = this._g;
        if (!g || !this._root)
            return;
        const now = GLib.get_monotonic_time();
        const dt = Math.min(100, Math.max(0, (now - this._lastFrame) / 1000));
        this._lastFrame = now;

        // suavização exponencial, independente da taxa de quadros (~95% do alvo em "ms")
        const kf = g.followMs <= 0 ? 1 : 1 - Math.exp(-dt * 3 / g.followMs);
        const ka = g.easeMs <= 0 ? 1 : 1 - Math.exp(-dt * 3 / g.easeMs);
        if (this._press)
            this._trackPointer();
        if (!this._g)
            return;                                   // o dock pode ter sido reconstruído

        this._px += (this._tpx - this._px) * kf;
        this._amt += (this._tamt - this._amt) * ka;

        const ks = Math.exp(-dt * 3 / SLIDE_MS);
        let sliding = false;
        for (let i = 0; i < this._slide.length; i++) {
            this._slide[i] *= ks;
            if (Math.abs(this._slide[i]) < 0.3)
                this._slide[i] = 0;
            else
                sliding = true;
        }

        const done = !this._press && !sliding &&
            Math.abs(this._tpx - this._px) < 0.25 && Math.abs(this._tamt - this._amt) < 0.002;
        if (done) {
            this._px = this._tpx;
            this._amt = this._tamt;
            this._tl.stop();
            if (this._tamt === 1)
                this._armZoomWatch();
        }
        this._apply(this._px, this._amt);
    }

    _onMotion(event) {
        if (!this._root || this._drag)
            return Clutter.EVENT_PROPAGATE;
        const [x] = event.get_coords();
        const [ox] = this._root.get_transformed_position();
        this._tpx = x - ox;
        if (this._amt < 0.05)
            this._px = this._tpx;           // entrando: cresce já no ponto certo
        this._tamt = 1;
        this._kick();
        this._setHover(this._indexAt(this._tpx));
        return Clutter.EVENT_PROPAGATE;
    }

    _onLeave() {
        if (!this._root || this._drag)
            return Clutter.EVENT_PROPAGATE;
        this._clearTimer('zoomWatch');
        this._tamt = 0;
        this._kick();
        this._setHover(-1);
        this._scheduleHide();
        return Clutter.EVENT_PROPAGATE;
    }

    // ------------------------------------------------------------------
    // Arrastar para reorganizar
    // ------------------------------------------------------------------
    // Ao pressionar um ícone, o laço por quadro passa a ler o ponteiro
    // (global.get_pointer funciona mesmo sobre outras janelas). Se o mouse
    // andar mais que DRAG_THRESHOLD com o botão pressionado, vira arrasto.
    _onPress(btn, event) {
        if (event.get_button() !== 1 || this._drag)
            return Clutter.EVENT_PROPAGATE;
        const i = this._items.findIndex(it => it.btn === btn);
        if (i < 0)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._press = {i, x, y};
        this._kick();
        return Clutter.EVENT_PROPAGATE;          // o clique normal continua funcionando
    }

    _trackPointer() {
        const [px, py, mods] = global.get_pointer();
        const held = (mods & Clutter.ModifierType.BUTTON1_MASK) !== 0;
        if (!held) {
            if (this._drag)
                this._endDrag();
            this._press = null;
            return;
        }
        if (!this._drag) {
            const dx = px - this._press.x;
            const dy = py - this._press.y;
            if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD)
                return;
            this._startDrag(px);
        }
        this._updateDrag(px, py);
    }

    _isFav(id) {
        return this._favs.isFavorite(id);
    }

    _startDrag(px) {
        const i = this._press.i;
        const it = this._items[i];
        if (!it)
            return;
        const [ox] = this._root.get_transformed_position();
        // cancela o quique deste ícone e o clique pendente do botão
        this._bouncing.delete(it.id);
        it.btn.remove_all_transitions();
        it.btn.fake_release();

        this._setHover(-1);
        this._drag = {
            i,
            id: it.id,
            fav: this._isFav(it.id),
            offX: this._centers[i] - (px - ox),
            x: this._centers[i],
            startOrder: [...this._order],
            out: false,
        };
        this._hideLabel(true);
        this._hidePreview();
        this._clearTimer('hide');
        it.dot.visible = false;
    }

    _updateDrag(px, py) {
        const g = this._g;
        const d = this._drag;
        const it = this._items[d.i];
        const [ox, oy] = this._root.get_transformed_position();
        const rel = px - ox;
        d.x = rel + d.offX;

        // longe do dock (mais de um ícone de distância) = soltar remove
        const top = oy;
        const bottom = oy + g.rootH;
        const dist = py < top ? top - py : py > bottom ? py - bottom : 0;
        d.out = g.dragRemove && d.fav && dist > g.S;
        it.btn.translation_y = py - this._press.y;
        it.btn.opacity = d.out ? 110 : 255;

        this._tpx = rel;
        this._tamt = dist > g.S ? 0 : 1;

        if (d.out)
            return;

        // nova posição: quantos outros ícones têm o centro à esquerda do arrastado
        const others = this._order.filter(j => j !== d.i);
        let slot = 0;
        for (const j of others) {
            if (this._centers[j] < d.x)
                slot++;
        }
        if (slot === this._order.indexOf(d.i))
            return;

        const visual = this._centers.map((c, j) => c + this._slide[j]);
        others.splice(slot, 0, d.i);
        this._order = others;
        this._apply(this._px, this._amt);             // calcula os novos lugares
        for (let j = 0; j < this._slide.length; j++) {
            if (j !== d.i)
                this._slide[j] = visual[j] - this._centers[j];   // e desliza até eles
        }
    }

    _endDrag() {
        const d = this._drag;
        const it = this._items[d.i];
        this._drag = null;
        const id = d.id;

        it.btn.ease({translation_y: 0, opacity: 255, duration: SLIDE_MS, mode: AM.EASE_OUT_QUAD});
        this._tamt = this._pointerInDock() ? 1 : 0;
        if (!this._tamt)
            this._scheduleHide();

        if (d.out) {
            this._favs.removeFavorite(id);                     // o dock se atualiza sozinho
            return;
        }

        // o ícone solto desliza do ponto onde foi solto até o seu lugar
        this._apply(this._px, this._amt);
        this._slide[d.i] = d.x - this._centers[d.i];
        this._updateDots();

        // posição entre os fixados = quantos fixados ficaram antes dele
        const slot = this._order.indexOf(d.i);
        let pos = 0;
        for (let s = 0; s < slot; s++) {
            if (this._isFav(this._items[this._order[s]].id))
                pos++;
        }
        const nFav = this._favs.getFavorites().length;

        if (d.fav) {
            const before = this._favs.getFavorites().findIndex(a => a.get_id() === id);
            if (pos !== before)
                this._favs.moveFavoriteToPos(id, pos);
        } else if (slot < nFav) {
            this._favs.addFavoriteAtPos(id, pos);              // app aberto solto entre os fixados: fixa
        } else {
            this._restoreOrder(d.startOrder);                  // apps não fixados não guardam ordem
        }
    }

    _restoreOrder(order) {
        const visual = this._centers.map((c, j) => c + this._slide[j]);
        this._order = order;
        this._apply(this._px, this._amt);
        for (let j = 0; j < this._slide.length; j++)
            this._slide[j] = visual[j] - this._centers[j];
        this._kick();
    }

    // A lista de favoritos passou a ter a mesma ordem que já está na tela:
    // reindexa os itens em vez de reconstruir (evita piscar).
    _adoptOrder() {
        const o = this._order;
        this._items = o.map(i => this._items[i]);
        this._slide = o.map(i => this._slide[i]);
        this._centers = o.map(i => this._centers[i]);
        this._widths = o.map(i => this._widths[i]);
        this._order = this._items.map((_it, i) => i);
        this._press = null;                 // índices antigos deixam de valer
        this._hoverIdx = -1;
        this._hidePreview();
    }

    // ------------------------------------------------------------------
    // Rótulo (nome do app)
    // ------------------------------------------------------------------
    // Ícone sob o ponteiro, calculado a partir do layout atual (estável
    // mesmo com os ícones deslizando). -1 = nenhum.
    _indexAt(px) {
        const g = this._g;
        const half = g.spacing / 2;
        for (let i = 0; i < g.n; i++) {
            const c = this._centers[i];
            const w = this._widths[i];
            if (px >= c - w / 2 - half && px <= c + w / 2 + half)
                return i;
        }
        return -1;
    }

    _setHover(i) {
        const g = this._g;
        if (!g || !this._label || i === this._hoverIdx || this._drag)
            return;
        this._hoverIdx = i;
        this._clearTimer('preview');

        if (i < 0) {
            this._hideLabel(false);
            if (this._previewWanted)
                this._setTimer('phide', 250, () => this._hidePreview());
            return;
        }

        this._clearTimer('phide');
        const it = this._items[i];
        const wantsPreview = g.previews && it && this._hasWindows(it.app);
        if (wantsPreview && (this._previewWanted || g.previewDelay <= 0)) {
            this._showPreview(i);                        // na hora
            return;
        }
        if (this._previewWanted)
            this._hidePreview();
        if (g.labels)
            this._showLabel();
        if (wantsPreview) {
            this._setTimer('preview', g.previewDelay, () => {
                if (this._hoverIdx === i)
                    this._showPreview(i);
            });
        }
    }

    _showLabel() {
        const it = this._items[this._hoverIdx];
        if (!it || !this._label)
            return;
        this._label.set_text(it.app.get_name());
        this._label.show();
        const [, lw] = this._label.get_preferred_width(-1);
        const [, lh] = this._label.get_preferred_height(lw);
        this._labelSize = [lw, lh];
        this._placeLabel();
        this._label.ease({opacity: 255, duration: 100, mode: AM.LINEAR});
    }

    _hideLabel(instant) {
        const label = this._label;
        if (!label)
            return;
        if (instant) {
            label.opacity = 0;
            label.hide();
            return;
        }
        label.ease({
            opacity: 0, duration: 100, mode: AM.LINEAR,
            onComplete: () => {
                if (this._label === label && label.opacity === 0)
                    label.hide();
            },
        });
    }

    _placeLabel() {
        if (this._hoverIdx < 0 || !this._label || !this._labelSize)
            return;
        const g = this._g;
        const w = this._widths[this._hoverIdx];
        const cx = this._centers[this._hoverIdx];
        if (w === undefined || cx === undefined)
            return;
        const [lw, lh] = this._labelSize;
        const x = Math.round(Math.max(0, Math.min(g.rootW - lw, cx - lw / 2)));
        const y = Math.round(g.atTop
            ? g.iconY + w + 8
            : g.iconY + g.M - w - lh - 8);
        this._label.set_position(x, y);
    }

    // ------------------------------------------------------------------
    // Prévia das janelas (miniaturas ao passar o mouse)
    // ------------------------------------------------------------------
    _hasWindows(app) {
        return app.state === Shell.AppState.RUNNING &&
            app.get_windows().some(w => w.get_compositor_private());
    }

    _buildPreview(cr, cg, cb, opacity) {
        const popup = new St.BoxLayout({
            style_class: 'cascade-dock-preview',
            style: `background-color: rgba(${cr}, ${cg}, ${cb}, ${Math.max(opacity, 0.85)});`,
            reactive: true,
            track_hover: true,
            visible: false,
            opacity: 0,
        });
        popup.connect('notify::hover', () => {
            if (popup.hover)
                this._clearTimer('phide');
            else if (this._previewWanted)
                this._setTimer('phide', 250, () => this._hidePreview());
        });
        // o LayoutManager pode reexibir o ator (fullscreen): respeitamos o estado
        popup.connect('notify::visible', () => {
            if (popup.visible && !this._previewWanted)
                popup.hide();
        });
        this._preview = popup;
        this._previewWanted = false;
        Main.layoutManager.addChrome(popup, {trackFullscreen: true});
    }

    _showPreview(i) {
        const it = this._items[i];
        const popup = this._preview;
        if (!it || !popup)
            return;
        const g = this._g;
        const wins = it.app.get_windows().filter(w => w.get_compositor_private());
        if (wins.length === 0) {
            this._hidePreview();
            return;
        }

        this._hideLabel(true);
        popup.destroy_all_children();

        const mon = Main.layoutManager.primaryMonitor;
        const shown = wins.slice(0, 8);
        const maxW = Math.max(90, Math.min(g.previewSize, Math.floor(mon.width * 0.9 / shown.length) - 28));
        const maxH = Math.round(maxW * 0.62);

        for (const win of shown) {
            const actor = win.get_compositor_private();
            const [ww, wh] = actor.get_size();
            const scale = Math.min(1, maxW / Math.max(ww, 1), maxH / Math.max(wh, 1));
            const clone = new Clutter.Clone({
                source: actor,
                width: Math.max(1, Math.round(ww * scale)),
                height: Math.max(1, Math.round(wh * scale)),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            const frame = new St.Bin({width: maxW, height: maxH});
            frame.set_child(clone);

            const title = new St.Label({
                text: win.get_title() || it.app.get_name(),
                style: 'color: white; font-size: 9.5pt;',
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            title.set_width(maxW);

            const col = new St.BoxLayout({vertical: true, style: 'spacing: 6px;'});
            col.add_child(frame);
            col.add_child(title);

            const btn = new St.Button({
                style_class: 'cascade-dock-thumb',
                reactive: true,
                can_focus: true,
                track_hover: true,
                button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            });
            btn.set_child(col);
            btn.connect('clicked', (_b, button) => {
                if (button === 2)
                    win.delete(global.get_current_time());      // clique do meio fecha
                else
                    Main.activateWindow(win);
                this._hidePreview();
            });
            popup.add_child(btn);
        }

        this._previewWanted = true;
        this._clearTimer('hide');
        popup.show();

        const wasVisible = popup.opacity > 0;
        const [, pw] = popup.get_preferred_width(-1);
        const [, ph] = popup.get_preferred_height(pw);
        this._previewIdx = i;
        this._previewW = pw;
        const y = g.atTop
            ? g.rootY + PAD_Y + g.M + 10
            : g.rootY + g.rootH - PAD_Y - g.M - ph - 10;
        popup.set_position(this._previewX(), y);
        if (wasVisible) {
            popup.remove_all_transitions();
            popup.opacity = 255;                         // troca de ícone: instantânea
        } else {
            popup.ease({opacity: 255, duration: 80, mode: AM.EASE_OUT_QUAD});
        }
    }

    _previewX() {
        const g = this._g;
        const mon = Main.layoutManager.primaryMonitor;
        const cx = g.rootX + (this._centers[this._previewIdx] ?? g.rootW / 2);
        const pw = this._previewW;
        return Math.round(Math.max(mon.x + 8, Math.min(mon.x + mon.width - pw - 8, cx - pw / 2)));
    }

    _hidePreview() {
        this._clearTimer('preview');
        this._clearTimer('phide');
        const popup = this._preview;
        if (!popup || !this._previewWanted)
            return;
        this._previewWanted = false;
        this._previewIdx = -1;
        popup.remove_all_transitions();
        popup.opacity = 0;
        popup.hide();
        this._scheduleHide();
    }

    // ------------------------------------------------------------------
    // Cliques e menu
    // ------------------------------------------------------------------
    _onClick(app, btn, button) {
        this._hideLabel(true);
        this._hidePreview();
        if (button === 3) {
            this._openMenu(app, btn);
            return;
        }
        if (button === 2) {
            app.open_new_window(-1);
            return;
        }
        if (app.state === Shell.AppState.STOPPED && this._g.bounce)
            this._startBounce(app);
        app.activate();
    }

    _openMenu(app, btn) {
        this._closeMenu();
        const menu = new PopupMenu.PopupMenu(btn, 0.5, this._g.atTop ? St.Side.TOP : St.Side.BOTTOM);
        Main.uiGroup.add_child(menu.actor);
        this._menuManager?.addMenu(menu);

        const id = app.get_id();
        menu.addAction('Nova janela', () => app.open_new_window(-1));
        const isFav = this._favs.isFavorite(id);
        menu.addAction(isFav ? 'Remover do dock' : 'Manter no dock', () => {
            if (isFav)
                this._favs.removeFavorite(id);
            else
                this._favs.addFavorite(id);
        });
        if (app.state === Shell.AppState.RUNNING)
            menu.addAction('Encerrar', () => app.request_quit());
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Configurações do Cascade Dock', () => this.openPreferences());

        menu.connect('open-state-changed', (_m, open) => {
            if (open)
                return;
            // destrói o menu fechado no próximo ciclo (fonte rastreada e removida no disable)
            this._setTimer('menuGc', 0, () => {
                if (this._menu === menu && !menu.isOpen)
                    this._closeMenu();
            });
            this._scheduleHide();
        });

        this._menu = menu;
        menu.open();
    }

    _closeMenu() {
        this._clearTimer('menuGc');
        if (!this._menu)
            return;
        const menu = this._menu;
        this._menu = null;
        menu.destroy();
    }

    // ------------------------------------------------------------------
    // Quique ao abrir app (estilo Mac)
    // ------------------------------------------------------------------
    _startBounce(app) {
        const id = app.get_id();
        if (this._bouncing.has(id))
            return;
        const st = {t0: GLib.get_monotonic_time(), gen: 0};
        this._bouncing.set(id, st);
        this._bounceStep(id, 0);
    }

    _bounceStep(id, gen) {
        const st = this._bouncing?.get(id);
        if (!st || st.gen !== gen)
            return;
        const it = this._items.find(i => i.id === id);
        const timedOut = GLib.get_monotonic_time() - st.t0 > 8000000;
        if (!it || timedOut || it.app.state === Shell.AppState.RUNNING) {
            this._bouncing.delete(id);
            if (it)
                it.btn.translation_y = 0;
            return;
        }
        const amp = Math.round(this._g.S * 0.45) * (this._g.atTop ? 1 : -1);
        it.btn.ease({
            translation_y: amp, duration: 260, mode: AM.EASE_OUT_QUAD,
            onComplete: () => {
                const cur = this._items.find(i => i.id === id);
                if (!cur || this._bouncing?.get(id)?.gen !== gen)
                    return;
                cur.btn.ease({
                    translation_y: 0, duration: 260, mode: AM.EASE_IN_QUAD,
                    onComplete: () => this._bounceStep(id, gen),
                });
            },
        });
    }

    // ------------------------------------------------------------------
    // Esconder (nunca / inteligente / sempre) e visão geral
    // ------------------------------------------------------------------
    _isShown() {
        return !this._overviewHidden && !(this._g && this._g.hideMode !== 'never' && this._hidden);
    }

    // inteligente: esconde só quando alguma janela ocupa o espaço do dock
    _wantsHide() {
        const mode = this._g?.hideMode;
        return mode === 'always' || (mode === 'smart' && this._overlap);
    }

    _setOverview(on) {
        this._overviewHidden = on && !!this._g?.hideInOverview;
        this._applyVisibility(true);
    }

    _applyVisibility(animate) {
        const root = this._root;
        if (!root)
            return;
        const g = this._g;
        const dur = animate ? g.hideMs : 0;

        // Importante: anima a posição real (y), não translation_y. O GNOME só
        // recalcula a área clicável de um "chrome" quando a alocação muda;
        // com translation_y a área ficava congelada fora do lugar e os
        // cliques caíam na janela de trás.
        const shownY = g.rootY;
        const hiddenY = g.rootY + g.hideShift;
        if (this._isShown()) {
            root.show();
            root.reactive = true;
            if (dur === 0) {
                root.y = shownY;
                root.opacity = 255;
            } else {
                root.ease({y: shownY, opacity: 255, duration: dur, mode: AM.EASE_OUT_QUAD});
            }
        } else {
            this._hideLabel(true);
            this._hidePreview();
            root.reactive = false;
            if (dur === 0) {
                root.y = hiddenY;
                root.opacity = 0;
                root.hide();
            } else {
                root.ease({
                    y: hiddenY, opacity: 0,
                    duration: dur, mode: AM.EASE_IN_QUAD,
                    onComplete: () => {
                        if (this._root === root && !this._isShown())
                            root.hide();
                    },
                });
            }
        }
    }

    _pointerInDock() {
        const [px, py] = global.get_pointer();
        const g = this._g;
        return px >= g.rootX && px <= g.rootX + g.rootW &&
               py >= g.rootY && py <= g.rootY + g.rootH;
    }

    _pointerAtEdge() {
        const [px, py] = global.get_pointer();
        const g = this._g;
        const inX = px >= g.rootX && px <= g.rootX + g.rootW;
        const atEdge = g.atTop
            ? py <= g.monY + g.edge
            : py >= g.monY + g.monH - 1 - g.edge;
        return inX && atEdge;
    }

    _scheduleHide() {
        if (!this._g || this._g.hideMode === 'never' || !this._root)
            return;
        this._setTimer('hide', this._g.hideDelay, () => {
            if (!this._root || !this._wantsHide())
                return;
            if (this._menu?.isOpen || this._previewWanted || this._press || this._pointerInDock() || this._pointerAtEdge()) {
                this._scheduleHide();
                return;
            }
            this._hidden = true;
            this._applyVisibility(true);
            this._startPoll();
        });
    }

    // Enquanto o dock está escondido, checa se o ponteiro foi à borda
    // (leve: só roda nesse estado).
    _startPoll() {
        if (this._pollId || !this._g || this._g.hideMode === 'never')
            return;
        this._edgeSince = 0;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            if (!this._root || !this._hidden || this._g.hideMode === 'never') {
                this._pollId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (!this._overviewHidden && this._pointerAtEdge()) {
                const now = GLib.get_monotonic_time() / 1000;
                if (!this._edgeSince)
                    this._edgeSince = now;
                if (now - this._edgeSince >= this._g.showDelay) {
                    this._pollId = 0;
                    this._hidden = false;
                    this._applyVisibility(true);
                    this._scheduleHide();
                    return GLib.SOURCE_REMOVE;
                }
            } else {
                this._edgeSince = 0;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ------------------------------------------------------------------
    // Ocultar inteligente: acompanha as janelas por sinais (sem consulta contínua)
    // ------------------------------------------------------------------
    _startTracking() {
        if (this._wt)
            return;
        const wt = this._wt = {conns: [], actors: new Map()};
        const q = () => this._queueOverlap();
        const add = (obj, sig, fn) => wt.conns.push([obj, obj.connect(sig, fn)]);

        add(global.display, 'restacked', q);
        add(global.display, 'notify::focus-window', q);
        add(global.workspace_manager, 'active-workspace-changed', q);
        for (const sig of ['minimize', 'unminimize', 'map', 'destroy', 'size-changed'])
            add(global.window_manager, sig, q);
        add(global.window_group, 'child-added', (_g, actor) => {
            this._trackActor(actor);
            q();
        });
        add(global.window_group, 'child-removed', (_g, actor) => {
            this._untrackActor(actor);
            q();
        });
        for (const actor of global.get_window_actors())
            this._trackActor(actor);
    }

    // mover ou redimensionar uma janela muda a alocação do seu ator
    _trackActor(actor) {
        if (!this._wt || !actor.get_meta_window || this._wt.actors.has(actor))
            return;
        this._wt.actors.set(actor, actor.connect('notify::allocation', () => this._queueOverlap()));
    }

    _untrackActor(actor) {
        const id = this._wt?.actors.get(actor);
        if (id) {
            actor.disconnect(id);
            this._wt.actors.delete(actor);
        }
    }

    _stopTracking() {
        if (!this._wt)
            return;
        for (const [obj, id] of this._wt.conns)
            obj.disconnect(id);
        for (const [actor, id] of this._wt.actors)
            actor.disconnect(id);
        this._wt = null;
        this._clearTimer('overlap');
    }

    // no máximo uma verificação a cada 100 ms, mesmo arrastando uma janela
    _queueOverlap() {
        if (this._timers.overlap)
            return;
        this._setTimer('overlap', 100, () => this._updateOverlap());
    }

    _updateOverlap() {
        if (!this._root || this._g?.hideMode !== 'smart')
            return;
        this._overlap = this._computeOverlap();
        if (this._overlap) {
            if (!this._hidden)
                this._scheduleHide();
        } else if (this._hidden) {
            this._hidden = false;                      // espaço livre: o dock volta
            this._applyVisibility(true);
        }
    }

    // Alguma janela visível nesta área de trabalho ocupa o retângulo do dock?
    _computeOverlap() {
        const g = this._g;
        const x0 = g.rootX + (g.rootW - g.baseTotal) / 2;
        const x1 = x0 + g.baseTotal;
        const y0 = g.atTop ? g.rootY : g.rootY + g.rootH - g.bgH;
        const y1 = y0 + g.bgH;
        const ws = global.workspace_manager.get_active_workspace();
        const monitor = Main.layoutManager.primaryIndex;
        const types = [
            Meta.WindowType.NORMAL, Meta.WindowType.DIALOG,
            Meta.WindowType.MODAL_DIALOG, Meta.WindowType.UTILITY,
        ];

        for (const actor of global.get_window_actors()) {
            const win = actor.get_meta_window();
            if (!win || win.minimized || win.skip_taskbar)
                continue;
            if (!types.includes(win.get_window_type()) || win.get_monitor() !== monitor)
                continue;
            if (!win.located_on_workspace(ws) || !win.showing_on_its_workspace())
                continue;
            const r = win.get_frame_rect();
            if (r.x < x1 && r.x + r.width > x0 && r.y < y1 && r.y + r.height > y0)
                return true;
        }
        return false;
    }
}
