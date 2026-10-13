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

    // Paired devices grouped by Address. A device paired with two adapters
    // is one Device1 object per adapter (/org/bluez/hci0/dev_…, hci1/dev_…)
    // and must show once. Each group lists the connected copy first, then
    // copies on a powered adapter.
    _pairedByAddress() {
        const powered = new Set(this._proxies(ADAPTER).filter(a => _prop(a, 'Powered') === true)
            .map(a => a.get_object_path()));
        const rank = d => (_prop(d, 'Connected') === true ? 0 : powered.has(_prop(d, 'Adapter')) ? 1 : 2);
        const groups = new Map();
        for (const d of this._proxies(DEVICE)) {
            if (_prop(d, 'Paired') !== true) continue;
            const key = String(_prop(d, 'Address') || d.get_object_path());
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(d);
        }
        for (const copies of groups.values())
            copies.sort((a, b) => rank(a) - rank(b) || a.get_object_path().localeCompare(b.get_object_path()));
        return [...groups.values()];
    }

    get state() {
        const adapters = this._proxies(ADAPTER);
        if (this._destroyed || adapters.length === 0) return { available: false };
        const powered = adapters.some(a => _prop(a, 'Powered') === true);
        const blocked = !powered && adapters.some(a => _prop(a, 'PowerState') === 'off-blocked');
        const devices = this._pairedByAddress()
            .map(copies => {
                const d = copies[0];
                return {
                    path: d.get_object_path(),
                    name: String(_prop(d, 'Alias') || _prop(d, 'Name') || d.get_object_path()),
                    icon: String(_prop(d, 'Icon') || 'bluetooth') + '-symbolic',
                    connected: copies.some(c => _prop(c, 'Connected') === true)
                };
            })
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

    // `path` is any copy of the device (see _pairedByAddress). Disconnect
    // drops every connected copy; connect tries the copies in order until
    // one adapter succeeds.
    async setDeviceConnected(path, on) {
        const copies = this._pairedByAddress().find(list => list.some(d => d.get_object_path() === path));
        if (!copies) return;
        const warn = e => global.logWarning('[switchboard] Bluetooth ' + (on ? 'connect' : 'disconnect') + ' failed: ' + e.message);
        if (!on) {
            await Promise.all(copies.filter(d => _prop(d, 'Connected') === true)
                .map(d => _call(d, 'Disconnect', null, 30000).catch(warn)));
            return;
        }
        let last = null;
        for (const d of copies) {
            if (this._destroyed) return;
            try { await _call(d, 'Connect', null, 30000); return; } catch (e) { last = e; }
        }
        if (last) warn(last);
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
