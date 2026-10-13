// Battery.js — the primary battery through csd-power
// (org.cinnamon.SettingsDaemon.Power GetPrimaryDevice). A desktop has no
// primary battery: the call fails, `available` stays false and the footer
// shows nothing.
//
//   const bat = new Battery();
//   bat.state → { available, percent, charging }
//   bat.destroy()

const Gio     = imports.gi.Gio;
const Signals = imports.signals;

const DBusProxy = require('./modules/shared/DBusProxy').DBusProxy;

var NAME = 'org.cinnamon.SettingsDaemon.Power';
var PATH = '/org/cinnamon/SettingsDaemon/Power';
var IFACE = 'org.cinnamon.SettingsDaemon.Power';
var STATE_CHARGING = 1;   // UPower device states

class Battery {
    constructor() {
        this._proxy = null;
        this._state = { available: false };
        this._destroyed = false;
        DBusProxy.create({ bus: 'session', name: NAME, path: PATH, iface: IFACE, flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START })
            .then(proxy => {
                if (this._destroyed) { proxy.destroy(); return; }
                this._proxy = proxy;
                proxy.onPropertiesChanged(() => this._refresh());
                proxy.onOwnerChanged(() => this._refresh());
                this._refresh();
            }, () => { /* no session bus: stays unavailable */ });
    }

    _refresh() {
        if (this._destroyed || !this._proxy) return;
        if (!this._proxy.available) { this._set({ available: false }); return; }
        // (sssusdut): path, vendor, model, type, icon, percentage, state, time
        this._proxy.call('GetPrimaryDevice').then(r => {
            const dev = Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r;
            this._set({ available: true, percent: Number(dev[5]), charging: (dev[6] | 0) === STATE_CHARGING });
        }, () => this._set({ available: false }));
    }

    _set(state) {
        if (this._destroyed) return;
        const a = this._state;
        if (a.available === state.available && a.percent === state.percent && a.charging === state.charging) return;
        this._state = state;
        this.emit('changed');
    }

    get state() {
        return this._destroyed ? { available: false } : this._state;
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._proxy) { this._proxy.destroy(); this._proxy = null; }
        this.disconnectAll();
    }
}
Signals.addSignalMethods(Battery.prototype);
