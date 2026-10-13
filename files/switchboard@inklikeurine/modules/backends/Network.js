// Network.js — Wi-Fi on/off and the current network, through libnm.
//
//   const net = new Network();      // connects asynchronously; emits 'changed' when ready
//   net.state → { available, present, enabled, hwEnabled, ssid, wired }
//   net.setEnabled(bool)
//   net.connect('changed', …); net.destroy()
//
// `present` is true when NetworkManager knows a Wi-Fi device. Everything is
// signal-driven; nothing polls.

const GLib    = imports.gi.GLib;
const Signals = imports.signals;

let NM = null;
try { NM = imports.gi.NM; } catch (e) { NM = null; }

class Network {
    constructor() {
        this._client = null;
        this._ids = [];            // client signal ids
        this._devIds = [];         // [device, id]
        this._destroyed = false;
        this.error = null;
        if (!NM) { this.error = 'libnm typelib (NM-1.0) not found'; return; }
        try {
            NM.Client.new_async(null, (obj, res) => {
                let client;
                try { client = NM.Client.new_finish(res); }
                catch (e) { this.error = e.message; this.emit('changed'); return; }
                if (this._destroyed) return;
                this._client = client;
                for (const sig of ['notify::wireless-enabled', 'notify::wireless-hardware-enabled', 'notify::primary-connection',
                                   'notify::active-connections', 'notify::nm-running'])
                    this._ids.push(client.connect(sig, () => this.emit('changed')));
                this._ids.push(client.connect('device-added', () => this._hookDevices()));
                this._ids.push(client.connect('device-removed', () => this._hookDevices()));
                this._hookDevices();
            });
        } catch (e) {
            this.error = e.message;
        }
    }

    _wifiDevices() {
        if (!this._client) return [];
        return (this._client.get_devices() || []).filter(d => d instanceof NM.DeviceWifi);
    }

    _hookDevices() {
        for (const [dev, id] of this._devIds) { try { dev.disconnect(id); } catch (e) { /* gone */ } }
        this._devIds = [];
        for (const dev of this._wifiDevices()) {
            this._devIds.push([dev, dev.connect('notify::active-access-point', () => this.emit('changed'))]);
            this._devIds.push([dev, dev.connect('notify::state', () => this.emit('changed'))]);
        }
        this.emit('changed');
    }

    get state() {
        const c = this._client;
        if (this._destroyed || !c || (typeof c.get_nm_running === 'function' && !c.get_nm_running()))
            return { available: false };
        let ssid = '';
        for (const dev of this._wifiDevices()) {
            const ap = dev.get_active_access_point();
            const bytes = ap ? ap.get_ssid() : null;
            if (bytes) { ssid = NM.utils_ssid_to_utf8(bytes.get_data()); break; }
        }
        const primary = c.get_primary_connection();
        const type = primary ? primary.get_connection_type() : '';
        return {
            available: true,
            present: this._wifiDevices().length > 0,
            enabled: c.wireless_enabled,
            hwEnabled: c.wireless_hardware_enabled,
            ssid,
            wired: type === '802-3-ethernet'
        };
    }

    setEnabled(on) {
        const c = this._client;
        if (!c) return;
        if (typeof c.dbus_set_property === 'function') {
            c.dbus_set_property(NM.DBUS_PATH, NM.DBUS_INTERFACE, 'WirelessEnabled', GLib.Variant.new_boolean(!!on), -1, null, (o, res) => {
                try { c.dbus_set_property_finish(res); }
                catch (e) { global.logWarning('[switchboard] Wi-Fi switch failed: ' + e.message); }
            });
        } else {
            c.wireless_enabled = !!on;
        }
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        for (const [dev, id] of this._devIds) { try { dev.disconnect(id); } catch (e) { /* gone */ } }
        this._devIds = [];
        if (this._client) for (const id of this._ids) this._client.disconnect(id);
        this._ids = [];
        this._client = null;
        this.disconnectAll();
    }
}
Signals.addSignalMethods(Network.prototype);
