// applet.js — Switchboard: quick settings menu with Wi-Fi, Bluetooth, Night
// Light, Do Not Disturb, power mode and Keep Awake toggles.
//
// Structure:
//   backends (modules/backends/, modules/shared/) — each owns one system
//     service, emits 'changed' / calls onChanged, never touches the UI
//   TileModel (modules/TileModel.js) — pure: backend states → tiles, pages,
//     tooltip
//   MenuView (modules/ui/MenuView.js) — draws what TileModel returns inside
//     the popup menu and reports clicks back here
// Every backend change queues one idle refresh; the refresh rebuilds the
// model and hands it to the view.

const Applet    = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings  = imports.ui.settings;
const Main      = imports.ui.main;
const Util      = imports.misc.util;
const GLib      = imports.gi.GLib;
const Gtk       = imports.gi.Gtk;
const St        = imports.gi.St;
const Gettext   = imports.gettext;

// Local modules through Cinnamon's require(): re-evaluated on every reload.
const TileModel  = require('./modules/TileModel');
const MenuView   = require('./modules/ui/MenuView').MenuView;
const Network    = require('./modules/backends/Network').Network;
const Bluetooth  = require('./modules/backends/Bluetooth').Bluetooth;
const KeepAwake  = require('./modules/backends/KeepAwake').KeepAwake;
const Brightness = require('./modules/backends/Brightness').Brightness;
const Battery    = require('./modules/backends/Battery').Battery;
const Spawn      = require('./modules/shared/Spawn');
const Dnd        = require('./modules/shared/Dnd').Dnd;
const PowerProfiles = require('./modules/shared/PowerProfiles').PowerProfiles;
const NightLight = require('./modules/shared/NightLight').NightLight;

const UUID = 'switchboard@inklikeurine';
const LOG_PREFIX = '[switchboard] ';
const PANEL_ICON = 'switchboard-symbolic';

Gettext.bindtextdomain(UUID, GLib.get_home_dir() + '/.local/share/locale');
function _(str) {
    const translated = Gettext.dgettext(UUID, str);
    return translated !== str ? translated : window._(str);
}

function _batteryIcon(b) {
    if (!b || !b.available) return 'battery-missing-symbolic';
    const p = b.percent;
    const level = p >= 90 ? 'full' : p >= 50 ? 'good' : p >= 20 ? 'low' : 'caution';
    return 'battery-' + level + (b.charging ? '-charging' : '') + '-symbolic';
}

class SwitchboardApplet extends Applet.IconApplet {

    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this._metadata   = metadata;
        this._instanceId = instanceId;
        this._destroyed  = false;
        this._signals    = [];      // [backend, id] pairs to disconnect on removal
        this._refreshId  = 0;
        this._page       = null;    // 'bluetooth' | 'nightlight' | 'power' | null
        this._hasBlueman = Spawn.available('blueman-manager');

        // Our icons (panel glyph, Keep Awake cup) resolve through the icon theme
        // so they recolour like any symbolic icon.
        const iconDir = metadata.path + '/icons';
        const theme = Gtk.IconTheme.get_default();
        if (theme && !theme.get_search_path().includes(iconDir)) theme.append_search_path(iconDir);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.set_applet_icon_symbolic_name(PANEL_ICON);
        this.set_applet_tooltip(_('Switchboard'));

        // ── Settings ─────────────────────────────────────────────────────
        this._settings = new Settings.AppletSettings(this, UUID, instanceId);
        this._settings.bind('tiles', '_tilesSetting', () => this._queueRefresh());
        this._settings.bind('show-brightness', '_showBrightness', () => this._queueRefresh());
        this._settings.bind('nightlight-temperature-slider', '_showTemperatureSlider', () => this._queueRefresh());
        this._settings.bind('key-open', '_keyOpen', () => this._setKeybinding());

        // ── Menu ─────────────────────────────────────────────────────────
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = new Applet.AppletPopupMenu(this, orientation);
        this._menuManager.addMenu(this._menu);
        this._menuOpenId = this._menu.connect('open-state-changed', (m, open) => {
            // The menu always opens on its main page.
            if (!open && this._page) { this._page = null; this._queueRefresh(); }
        });
        this._view = new MenuView(this._menu, {
            iconFor: (icon, name) => { icon.icon_name = name; icon.icon_type = St.IconType.SYMBOLIC; },
            onToggle: id => this._toggle(id),
            onArrow: id => this._arrow(id),
            onBack: () => this._showPage(null),
            onMaster: id => this._toggle(id),
            onDevice: (path, on) => this._bt.setDeviceConnected(path, on),
            onBrightness: p => this._brightness.set(p),
            onTemperature: k => { if (this._night) this._night.setTemperature(k); },
            onPause: () => this._togglePause(),
            onProfile: id => { if (this._power) this._power.set(id).catch(e => global.logWarning(LOG_PREFIX + 'power mode: ' + e.message)); },
            onAccentChanged: () => this._refresh(),
            openBluetoothSettings: () => this._launch('blueman-manager'),
            openNightLightSettings: () => this._launch('cinnamon-settings nightlight'),
            openSystemSettings: () => this._launch('cinnamon-settings')
        }, _);

        // ── Backends ─────────────────────────────────────────────────────
        this._net = this._watch(new Network());
        this._bt = this._watch(new Bluetooth());
        this._awake = this._watch(new KeepAwake());
        this._brightness = this._watch(new Brightness());
        this._battery = this._watch(new Battery());
        this._dnd = new Dnd();
        this._dnd.onChanged(() => this._queueRefresh());

        this._power = null;
        PowerProfiles.create().then(pp => {
            if (this._destroyed) { pp.destroy(); return; }
            this._power = pp;
            pp.onChanged(() => this._queueRefresh());
            this._queueRefresh();
        }, e => global.logWarning(LOG_PREFIX + 'power profiles unavailable: ' + e.message));

        this._night = null;
        NightLight.create().then(nl => {
            if (this._destroyed) { nl.destroy(); return; }
            this._night = nl;
            nl.onChanged(() => this._queueRefresh());
            this._queueRefresh();
        });

        this._setKeybinding();
        this._refresh();
    }

    _watch(backend) {
        this._signals.push([backend, backend.connect('changed', () => this._queueRefresh())]);
        return backend;
    }

    _queueRefresh() {
        if (this._destroyed || this._refreshId) return;
        this._refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._refreshId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _state() {
        const nl = this._night, pp = this._power;
        return {
            wifi: this._net.state,
            bt: this._bt.state,
            night: nl && nl.available ? {
                available: true, enabled: nl.enabled, active: nl.active, paused: nl.pausedUntilTomorrow,
                until: nl.untilText(), temperature: nl.temperature, canPause: nl.canPause
            } : { available: false },
            dnd: { available: true, active: this._dnd.active },
            power: pp && pp.available ? { available: true, active: pp.active, profiles: pp.profiles, holds: pp.holds } : { available: false },
            awake: this._awake.state
        };
    }

    _refresh() {
        if (this._destroyed) return;
        const s = this._state();
        let page = this._page ? TileModel.page(this._page, s, _) : null;
        if (this._page && !page) this._page = null;     // its backend went away
        const br = this._brightness.state;
        const bat = this._battery.state;
        this._view.render({
            tiles: TileModel.tiles(s, this._tilesSetting, _),
            page,
            brightness: { visible: this._showBrightness !== false && br.available, percent: br.percent },
            battery: { text: TileModel.batteryText(bat), icon: _batteryIcon(bat) },
            showTemperatureSlider: this._showTemperatureSlider !== false,
            bluetoothSettings: this._hasBlueman
        });
        this.set_applet_tooltip(TileModel.tooltip(s, _));
    }

    _showPage(id) {
        this._page = id;
        this._refresh();
    }

    _toggle(id) {
        const s = this._state();
        switch (id) {
        case 'wifi':
            this._net.setEnabled(!(s.wifi.enabled && s.wifi.hwEnabled !== false));
            break;
        case 'bluetooth':
            this._bt.setPowered(!(s.bt.powered && !s.bt.blocked));
            break;
        case 'nightlight':
            if (!this._night) break;
            if (s.night.paused) this._togglePause();
            else this._night.setEnabled(!s.night.enabled);
            break;
        case 'dnd':
            this._dnd.toggle();
            break;
        case 'power':
            this._showPage('power');
            break;
        case 'awake':
            this._awake.setOn(!s.awake.on);
            break;
        }
    }

    _arrow(id) {
        const t = TileModel.tile(id, this._state(), _);
        if (!t) return;
        if (t.arrow === 'page') this._showPage(id);
        else if (t.arrow === 'launch') this._launch(t.launch);
    }

    _togglePause() {
        const nl = this._night;
        if (!nl) return;
        nl.setPausedUntilTomorrow(!nl.pausedUntilTomorrow)
            .catch(e => global.logWarning(LOG_PREFIX + 'Night Light pause: ' + e.message));
    }

    _launch(command) {
        this._menu.close();
        Util.spawnCommandLine(command);
    }

    _setKeybinding() {
        if (this._destroyed) return;
        Main.keybindingManager.addXletHotKey(this, 'switchboard-open', this._keyOpen || '', () => this.on_applet_clicked(null));
    }

    on_applet_clicked(event) {
        if (!this._menu.isOpen && this._page) this._showPage(null);
        this._menu.toggle();
    }

    on_orientation_changed(orientation) {
        this._menu.setOrientation(orientation);
    }

    on_applet_removed_from_panel(deleteConfig) {
        // Cinnamon calls this on removal AND on reload. Every step is guarded
        // so one failure cannot skip the next; Keep Awake's inhibitor is
        // released by its destroy().
        this._destroyed = true;
        const step = (name, fn) => { try { fn(); } catch (e) { global.logError(LOG_PREFIX + 'teardown "' + name + '" failed: ' + e.message); } };

        step('refresh', () => { if (this._refreshId) { GLib.source_remove(this._refreshId); this._refreshId = 0; } });
        step('hotkey', () => Main.keybindingManager.removeXletHotKey(this, 'switchboard-open'));
        step('signals', () => {
            for (const [obj, id] of this._signals) { try { obj.disconnect(id); } catch (e) { /* gone */ } }
            this._signals = [];
        });
        step('backends', () => {
            for (const b of [this._net, this._bt, this._awake, this._brightness, this._battery, this._dnd, this._power, this._night])
                if (b) b.destroy();
            this._power = null;
            this._night = null;
        });
        step('view', () => this._view.destroy());
        step('menu', () => {
            if (this._menuOpenId) { this._menu.disconnect(this._menuOpenId); this._menuOpenId = 0; }
            this._menu.destroy();
        });
        step('settings', () => { if (this._settings) { this._settings.finalize(); this._settings = null; } });
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new SwitchboardApplet(metadata, orientation, panelHeight, instanceId);
}
