// Network.js — Wi-Fi on/off, the current network and the visible networks,
// through libnm.
//
//   const net = new Network();      // connects asynchronously; emits 'changed' when ready
//   net.state → { available, present, enabled, hwEnabled, ssid, wired }
//   net.networks() → [{ ssid, strength, security, active, connecting, known }]  (groupNetworks)
//   net.scan()                       // ask NetworkManager for a fresh scan (rate-limited)
//   net.connectTo(ssid) → null | { launch: argv }   // argv: 802.1X needs cinnamon-settings
//   net.setEnabled(bool)
//   net.connect('changed', …); net.destroy()
//
// `present` is true when NetworkManager knows a Wi-Fi device. Everything is
// signal-driven; nothing polls. Connecting follows Cinnamon's network applet:
// a saved connection is activated; otherwise a new automatic connection is
// added and NetworkManager asks Cinnamon's network agent for the password.

const GLib    = imports.gi.GLib;
const Signals = imports.signals;

let NM = null;
try { NM = imports.gi.NM; } catch (e) { NM = null; }

var SCAN_MIN_S = 10;      // NetworkManager refuses scans in quick succession anyway
var SECURITY_RANK = { none: 0, wep: 1, psk: 2, enterprise: 3 };

// Pure: access points ({ ssid, strength, security, active, connecting, known })
// → one entry per network name (hidden networks, ssid '', are dropped): the
// strongest signal, the strictest security, active/connecting/known if any
// access point is. Order: active, connecting, saved, strongest, name.
function groupNetworks(aps) {
    const byName = new Map();
    for (const ap of aps || []) {
        if (!ap || !ap.ssid) continue;
        let n = byName.get(ap.ssid);
        if (!n) {
            n = { ssid: ap.ssid, strength: -1, security: 'none', active: false, connecting: false, known: false };
            byName.set(ap.ssid, n);
        }
        if ((ap.strength | 0) > n.strength) n.strength = ap.strength | 0;
        if ((SECURITY_RANK[ap.security] || 0) > SECURITY_RANK[n.security]) n.security = ap.security;
        n.active = n.active || !!ap.active;
        n.connecting = n.connecting || !!ap.connecting;
        n.known = n.known || !!ap.known;
    }
    return [...byName.values()].sort((a, b) =>
        (b.active - a.active) || (b.connecting - a.connecting) || (b.known - a.known) ||
        (b.strength - a.strength) || a.ssid.localeCompare(b.ssid));
}

function _ssid(bytes) {
    return bytes ? NM.utils_ssid_to_utf8(bytes.get_data()) : '';
}

class Network {
    constructor() {
        this._client = null;
        this._ids = [];            // client signal ids
        this._devIds = [];         // [device, id]
        this._destroyed = false;
        this._lastScan = 0;
        this._pending = null;      // ssid being connected to, until the device settles
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
                this._ids.push(client.connect('connection-added', () => this.emit('changed')));
                this._ids.push(client.connect('connection-removed', () => this.emit('changed')));
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
            this._devIds.push([dev, dev.connect('notify::state', () => {
                const st = dev.get_state();
                if (st === NM.DeviceState.ACTIVATED || st === NM.DeviceState.FAILED) this._pending = null;
                this.emit('changed');
            })]);
            for (const sig of ['access-point-added', 'access-point-removed', 'notify::last-scan'])
                this._devIds.push([dev, dev.connect(sig, () => this.emit('changed'))]);
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

    _security(ap) {
        const S = NM['80211ApSecurityFlags'];
        const rsn = ap.get_rsn_flags(), wpa = ap.get_wpa_flags();
        const flags = rsn !== S.NONE ? rsn : wpa;
        if (flags !== S.NONE) {
            if (flags & S.KEY_MGMT_802_1X) return 'enterprise';
            const OWE = S.KEY_MGMT_OWE || 0, KEYED = S.KEY_MGMT_PSK | (S.KEY_MGMT_SAE || 0);
            if ((flags & OWE) && !(flags & KEYED)) return 'none';   // encrypted, no password
            return 'psk';
        }
        return (ap.get_flags() & NM['80211ApFlags'].PRIVACY) ? 'wep' : 'none';
    }

    _savedSsids() {
        const out = new Set();
        for (const c of (this._client && this._client.get_connections()) || []) {
            const w = c.get_setting_wireless();
            if (w && w.get_ssid()) out.add(_ssid(w.get_ssid()));
        }
        return out;
    }

    networks() {
        if (this._destroyed || !this._client) return [];
        const saved = this._savedSsids();
        const aps = [];
        for (const dev of this._wifiDevices()) {
            const activeAp = dev.get_active_access_point();
            const st = dev.get_state();
            const settling = st >= NM.DeviceState.PREPARE && st < NM.DeviceState.ACTIVATED;
            for (const ap of dev.get_access_points() || []) {
                const ssid = _ssid(ap.get_ssid());
                const isActive = !!activeAp && activeAp.get_path() === ap.get_path();
                aps.push({ ssid, strength: ap.get_strength(), security: this._security(ap), known: saved.has(ssid),
                           active: isActive && !settling,
                           connecting: (isActive && settling) || (this._pending === ssid && !isActive) });
            }
        }
        return groupNetworks(aps);
    }

    scan() {
        const now = GLib.get_monotonic_time() / 1e6;
        if (this._destroyed || now - this._lastScan < SCAN_MIN_S) return;
        this._lastScan = now;
        for (const dev of this._wifiDevices()) {
            dev.request_scan_async(null, (d, res) => {
                try { d.request_scan_finish(res); } catch (e) { /* NM refuses while busy or right after a scan */ }
            });
        }
    }

    // The strongest access point named `ssid` and its device, or null.
    _accessPoint(ssid) {
        let best = null;
        for (const dev of this._wifiDevices())
            for (const ap of dev.get_access_points() || [])
                if (_ssid(ap.get_ssid()) === ssid && (!best || ap.get_strength() > best.ap.get_strength())) best = { dev, ap };
        return best;
    }

    connectTo(ssid) {
        const c = this._client;
        const found = !this._destroyed && c ? this._accessPoint(ssid) : null;
        if (!found) return null;
        const { dev, ap } = found;
        const fail = e => {
            this._pending = null;
            global.logWarning('[switchboard] connecting to Wi-Fi network failed: ' + e.message);
            this.emit('changed');
        };
        const saved = ap.filter_connections(dev.filter_connections(c.get_connections() || []));
        if (saved.length) {
            const used = x => { const sc = x.get_setting_connection(); return sc ? sc.get_timestamp() : 0; };
            saved.sort((a, b) => used(b) - used(a));
            this._pending = ssid;
            c.activate_connection_async(saved[0], dev, ap.get_path(), null, (o, res) => {
                try { c.activate_connection_finish(res); } catch (e) { fail(e); }
            });
            this.emit('changed');
            return null;
        }
        const security = this._security(ap);
        if (security === 'enterprise')   // 802.1X needs more than a password
            return { launch: ['cinnamon-settings', 'network', 'connect-8021x-wifi', dev.get_path(), ap.get_path()] };
        this._pending = ssid;
        c.add_and_activate_connection_async(this._automaticConnection(ssid, security), dev, ap.get_path(), null, (o, res) => {
            try { c.add_and_activate_connection_finish(res); } catch (e) { fail(e); }
        });
        this.emit('changed');
        return null;
    }

    // As Cinnamon's network applet builds it: NetworkManager fills in the
    // rest from the access point. Without permission to change system
    // connections it belongs to this user and the agent keeps the secret.
    _automaticConnection(ssid, security) {
        const connection = new NM.SimpleConnection();
        connection.add_setting(new NM.SettingWireless());
        const setting = new NM.SettingConnection({
            id: ssid, autoconnect: true, uuid: NM.utils_uuid_generate(), type: NM.SETTING_WIRELESS_SETTING_NAME
        });
        if (this._client.get_permission_result(NM.ClientPermission.SETTINGS_MODIFY_SYSTEM) !== NM.ClientPermissionResult.YES) {
            setting.add_permission('user', GLib.get_user_name(), null);
            if (security === 'psk')
                connection.add_setting(new NM.SettingWirelessSecurity({ psk_flags: NM.SettingSecretFlags.AGENT_OWNED }));
            else if (security === 'wep')
                connection.add_setting(new NM.SettingWirelessSecurity({ wep_key_flags: NM.SettingSecretFlags.AGENT_OWNED }));
        }
        connection.add_setting(setting);
        return connection;
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
