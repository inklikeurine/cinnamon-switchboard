// Bluetooth.js — BlueZ over raw DBus (there is no GnomeBluetooth typelib on
// Mint 22.3): adapters on/off, paired devices, connect/disconnect.
//
//   const bt = new Bluetooth();     // emits 'changed' when the object manager is ready
//   bt.state → { available, powered, blocked, devices: [{ path, name, icon, connected }] }
//   bt.setPowered(bool)             // all adapters; unblocks rfkill first when needed
//   bt.setDeviceConnected(path, bool)
//   bt.connect('changed', …); bt.destroy()
//
// `blocked` comes from Adapter1.PowerState === 'off-blocked' (BlueZ ≥ 5.64).
// Turning Bluetooth on while blocked runs `rfkill unblock bluetooth`
// (util-linux; /dev/rfkill is writable by the seat user, no password) and
// then powers the adapters.

const Gio     = imports.gi.Gio;
const GLib    = imports.gi.GLib;
const Signals = imports.signals;

const Spawn = require('./modules/shared/Spawn');

var BLUEZ = 'org.bluez';
var ADAPTER = 'org.bluez.Adapter1';
var DEVICE = 'org.bluez.Device1';

function _prop(proxy, name) {
    const v = proxy.get_cached_property(name);
    return v ? v.deepUnpack() : undefined;
}

function _call(proxy, method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
        proxy.call(method, params || null, Gio.DBusCallFlags.NONE, timeoutMs || 10000, null, (p, res) => {
            try { resolve(p.call_finish(res)); } catch (e) { reject(e); }
        });
    });
}

class Bluetooth {
    constructor() {
        this._manager = null;
        this._ids = [];
        this._destroyed = false;
        this._busy = false;
        this._waitId = 0;
        this.error = null;
        Gio.DBusObjectManagerClient.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusObjectManagerClientFlags.DO_NOT_AUTO_START,
            BLUEZ, '/', null, null, (o, res) => {
                let manager;
                try { manager = Gio.DBusObjectManagerClient.new_for_bus_finish(res); }
                catch (e) { this.error = e.message; this.emit('changed'); return; }
                if (this._destroyed) return;
                this._manager = manager;
                for (const sig of ['object-added', 'object-removed', 'interface-added', 'interface-removed',
                                   'interface-proxy-properties-changed', 'notify::name-owner'])
                    this._ids.push(manager.connect(sig, () => this.emit('changed')));
                this.emit('changed');
            });
    }

    _proxies(iface) {
        if (!this._manager || !this._manager.get_name_owner()) return [];
        const out = [];
        for (const obj of this._manager.get_objects()) {
            const p = obj.get_interface(iface);
            if (p) out.push(p);
        }
        return out;
    }

    get state() {
        const adapters = this._proxies(ADAPTER);
        if (this._destroyed || adapters.length === 0) return { available: false };
        const powered = adapters.some(a => _prop(a, 'Powered') === true);
        const blocked = !powered && adapters.some(a => _prop(a, 'PowerState') === 'off-blocked');
        const devices = this._proxies(DEVICE)
            .filter(d => _prop(d, 'Paired') === true)
            .map(d => ({
                path: d.get_object_path(),
                name: String(_prop(d, 'Alias') || _prop(d, 'Name') || d.get_object_path()),
                icon: String(_prop(d, 'Icon') || 'bluetooth') + '-symbolic',
                connected: _prop(d, 'Connected') === true
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return { available: true, powered, blocked, devices };
    }

    async setPowered(on) {
        const adapters = this._proxies(ADAPTER);
        if (!adapters.length || this._busy) return;
        this._busy = true;
        try {
            if (on && adapters.some(a => _prop(a, 'PowerState') === 'off-blocked')) await this._unblock();
            for (const a of adapters) {
                if (this._destroyed) return;
                try {
                    await this._setPowered(a, on);
                } catch (e) {
                    if (!on || !/rfkill|blocked|NotReady/i.test(e.message)) throw e;
                    await this._unblock();
                    await this._setPowered(a, on);
                }
            }
        } catch (e) {
            global.logWarning('[switchboard] Bluetooth ' + (on ? 'on' : 'off') + ' failed: ' + e.message);
        } finally {
            this._busy = false;
        }
    }

    _setPowered(adapter, on) {
        return _call(adapter, 'org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [ADAPTER, 'Powered', GLib.Variant.new_boolean(!!on)]));
    }

    async _unblock() {
        if (!Spawn.available('rfkill')) throw new Error('Bluetooth is blocked and rfkill is not installed');
        const r = await Spawn.run(['rfkill', 'unblock', 'bluetooth'], { timeoutMs: 5000 });
        if (!r.ok) throw new Error('rfkill unblock bluetooth failed: ' + (r.error || r.stderr.trim() || r.status));
        // BlueZ notices the unblock asynchronously.
        await new Promise(resolve => {
            this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => { this._waitId = 0; resolve(); return GLib.SOURCE_REMOVE; });
        });
        if (this._destroyed) throw new Error('removed');
    }

    setDeviceConnected(path, on) {
        const dev = this._proxies(DEVICE).find(d => d.get_object_path() === path);
        if (!dev) return Promise.resolve();
        return _call(dev, on ? 'Connect' : 'Disconnect', null, 30000)
            .catch(e => global.logWarning('[switchboard] Bluetooth ' + (on ? 'connect' : 'disconnect') + ' failed: ' + e.message));
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this._waitId) { GLib.source_remove(this._waitId); this._waitId = 0; }
        if (this._manager) for (const id of this._ids) this._manager.disconnect(id);
        this._ids = [];
        this._manager = null;
        this.disconnectAll();
    }
}
Signals.addSignalMethods(Bluetooth.prototype);
