// Brightness.js — screen backlight through csd-power
// (org.cinnamon.SettingsDaemon.Power.Screen). A desktop without a backlight
// answers every call with an error; then `available` stays false and the
// slider is hidden.
//
//   const br = new Brightness();
//   br.state → { available, percent }
//   br.set(percent)                  // coalesced: at most one call in flight
//   br.destroy()

const Gio     = imports.gi.Gio;
const GLib    = imports.gi.GLib;
const Signals = imports.signals;

const DBusProxy = require('./modules/shared/DBusProxy').DBusProxy;

var NAME = 'org.cinnamon.SettingsDaemon.Power';
var PATH = '/org/cinnamon/SettingsDaemon/Power';
var IFACE = 'org.cinnamon.SettingsDaemon.Power.Screen';

class Brightness {
    constructor() {
        this._proxy = null;
        this._available = false;
        this._percent = 0;
        this._destroyed = false;
        this._inFlight = false;
        this._queued = null;
        DBusProxy.create({ bus: 'session', name: NAME, path: PATH, iface: IFACE, flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START })
            .then(proxy => {
                if (this._destroyed) { proxy.destroy(); return; }
                this._proxy = proxy;
                proxy.onSignal('Changed', () => this._refresh());
                proxy.onOwnerChanged(() => this._refresh());
                this._refresh();
            }, () => { /* no session bus: stays unavailable */ });
    }

    _refresh() {
        if (this._destroyed || !this._proxy) return;
        if (!this._proxy.available) { this._set(false, 0); return; }
        this._proxy.call('GetPercentage').then(([p]) => this._set(true, p | 0), () => this._set(false, 0));
    }

    _set(available, percent) {
        if (this._destroyed) return;
        if (available === this._available && percent === this._percent) return;
        this._available = available;
        this._percent = percent;
        this.emit('changed');
    }

    get state() {
        return { available: !this._destroyed && this._available, percent: this._percent };
    }

    set(percent) {
        if (this._destroyed || !this._proxy || !this._available) return;
        const p = Math.max(1, Math.min(100, Math.round(percent)));
        if (this._inFlight) { this._queued = p; return; }
        this._inFlight = true;
        this._proxy.call('SetPercentage', new GLib.Variant('(u)', [p])).catch(() => {}).then(() => {
            this._inFlight = false;
            if (this._destroyed) return;
            const next = this._queued;
            this._queued = null;
            if (next !== null && next !== p) this.set(next);
        });
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._proxy) { this._proxy.destroy(); this._proxy = null; }
        this.disconnectAll();
    }
}
Signals.addSignalMethods(Brightness.prototype);
