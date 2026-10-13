// TileModel.js — pure: backend states → what the menu shows.
//
// No imports.gi, no imports.ui: everything here runs under plain cjs and is
// covered by .dev/tests/switchboard@inklikeurine/tilemodel.test.js. The UI
// (modules/ui/) draws exactly what build() returns and never reads a
// backend itself.
//
// Input `s` (every part optional; a missing part means "not available"):
//   wifi:  { available, present, enabled, hwEnabled, ssid, wired }
//   bt:    { available, powered, blocked, devices: [{ path, name, icon, connected }] }
//   night: { available, enabled, active, paused, until, temperature }
//   dnd:   { available, active }
//   power: { available, active, profiles: [ids], holds: [{ appId, profile }] }
//   awake: { available, on, heldBy }

var TILE_IDS = ['wifi', 'bluetooth', 'nightlight', 'dnd', 'power', 'awake'];

// Names stored in the `tiles` setting (the list widget shows them as they are).
var TILE_NAMES = {
    wifi: 'Wi-Fi',
    bluetooth: 'Bluetooth',
    nightlight: 'Night Light',
    dnd: 'Do Not Disturb',
    power: 'Power Mode',
    awake: 'Keep Awake'
};

var PROFILE_NAMES = { 'power-saver': 'Power Saver', 'balanced': 'Balanced', 'performance': 'Performance' };

var PROFILE_ICONS = {
    'power-saver': 'power-profile-power-saver-symbolic',
    'balanced': 'power-profile-balanced-symbolic',
    'performance': 'power-profile-performance-symbolic'
};

function _id(x) { return x; }

// The `tiles` setting → [{ id, enabled }] in the user's order. Unknown names
// are dropped; tiles missing from the setting are appended, shown.
function order(setting) {
    const byName = {};
    for (const id of TILE_IDS) byName[TILE_NAMES[id].toLowerCase()] = id;
    const out = [];
    const seen = new Set();
    for (const row of Array.isArray(setting) ? setting : []) {
        const id = row && byName[String(row.tile || '').toLowerCase()];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, enabled: row.enabled !== false });
    }
    for (const id of TILE_IDS) if (!seen.has(id)) out.push({ id, enabled: true });
    return out;
}

function defaultSetting() {
    return TILE_IDS.map(id => ({ tile: TILE_NAMES[id], enabled: true }));
}

function _profileName(id, _) {
    return _(PROFILE_NAMES[id] || id);
}

// One tile's model, or null when its backend is unavailable.
//   arrow: 'page' (opens a page in the menu), 'launch' (opens a settings
//   program, `launch` holds the command line) or null.
function tile(id, s, _) {
    _ = _ || _id;
    if (id === 'wifi') {
        const w = s.wifi;
        if (!w || !w.available) return null;
        if (!w.present) {
            if (!w.wired) return null;
            return { id, title: _('Wi-Fi'), status: _('Wired'), icon: 'network-wired-symbolic', checked: false, sensitive: false,
                     arrow: 'launch', launch: 'cinnamon-settings network' };
        }
        const hw = w.hwEnabled !== false;
        const on = hw && !!w.enabled;
        let status;
        if (!hw) status = _('Hardware off');
        else if (!on) status = _('Off');
        else if (w.ssid) status = w.ssid;
        else if (w.wired) status = _('Wired');
        else status = _('Not connected');
        return { id, title: _('Wi-Fi'), status, icon: on ? 'network-wireless-signal-excellent-symbolic' : 'network-wireless-offline-symbolic',
                 checked: on, sensitive: hw, arrow: 'launch', launch: 'cinnamon-settings network' };
    }
    if (id === 'bluetooth') {
        const b = s.bt;
        if (!b || !b.available) return null;
        const n = (b.devices || []).filter(d => d.connected).length;
        let status;
        if (b.blocked) status = _('Blocked');
        else if (!b.powered) status = _('Off');
        else if (n === 1) status = _('1 connected');
        else if (n > 1) status = _('%d connected').replace('%d', String(n));
        else status = _('On');
        return { id, title: _('Bluetooth'), status, icon: b.powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic',
                 checked: !!b.powered && !b.blocked, sensitive: true, arrow: 'page' };
    }
    if (id === 'nightlight') {
        const n = s.night;
        if (!n || !n.available) return null;
        const on = !!n.enabled && !n.paused;
        let status;
        if (!n.enabled) status = _('Off');
        else if (n.paused) status = _('Paused');
        else if (n.until) status = _('On until %s').replace('%s', n.until);
        else status = _('On');
        return { id, title: _('Night Light'), status, icon: 'night-light-symbolic', checked: on, sensitive: true, arrow: 'page' };
    }
    if (id === 'dnd') {
        const d = s.dnd;
        if (!d || !d.available) return null;
        return { id, title: _('Do Not Disturb'), status: d.active ? _('On') : _('Off'), icon: 'notifications-disabled-symbolic',
                 checked: !!d.active, sensitive: true, arrow: 'launch', launch: 'cinnamon-settings notifications' };
    }
    if (id === 'power') {
        const p = s.power;
        if (!p || !p.available) return null;
        const holds = p.holds || [];
        const status = holds.length ? _('Held by %s').replace('%s', holds[0].appId || _('an application')) : _profileName(p.active, _);
        return { id, title: _('Power Mode'), status, icon: PROFILE_ICONS[p.active] || PROFILE_ICONS.balanced,
                 checked: !!p.active && p.active !== 'balanced', sensitive: true, arrow: 'page', opensPage: true };
    }
    if (id === 'awake') {
        const a = s.awake;
        if (!a || !a.available) return null;
        let status;
        if (a.on) status = _('Screen stays on');
        else if (a.heldBy) status = _('Held by %s').replace('%s', a.heldBy);
        else status = _('Off');
        return { id, title: _('Keep Awake'), status, icon: 'switchboard-awake-symbolic', checked: !!a.on, sensitive: true, arrow: null };
    }
    return null;
}

// Every visible tile in the user's order.
function tiles(s, tilesSetting, _) {
    const out = [];
    for (const { id, enabled } of order(tilesSetting)) {
        if (!enabled) continue;
        const t = tile(id, s || {}, _);
        if (t) out.push(t);
    }
    return out;
}

// One line for the panel tooltip: "Wi-Fi: MyNetwork · Bluetooth off · DND on · Balanced".
function tooltip(s, _) {
    _ = _ || _id;
    s = s || {};
    const parts = [];
    const w = s.wifi;
    if (w && w.available && w.present) {
        if (w.hwEnabled === false || !w.enabled) parts.push(_('Wi-Fi off'));
        else parts.push(_('Wi-Fi: %s').replace('%s', w.ssid || _('not connected')));
    } else if (w && w.available && w.wired) {
        parts.push(_('Wired'));
    }
    const b = s.bt;
    if (b && b.available) {
        const n = (b.devices || []).filter(d => d.connected).length;
        if (b.blocked) parts.push(_('Bluetooth blocked'));
        else if (!b.powered) parts.push(_('Bluetooth off'));
        else if (n) parts.push(_('Bluetooth: %d connected').replace('%d', String(n)));
        else parts.push(_('Bluetooth on'));
    }
    const n = s.night;
    if (n && n.available && n.enabled && !n.paused) parts.push(_('Night Light on'));
    if (s.dnd && s.dnd.available) parts.push(s.dnd.active ? _('DND on') : _('DND off'));
    if (s.power && s.power.available) parts.push(_profileName(s.power.active, _));
    if (s.awake && s.awake.available && s.awake.on) parts.push(_('Keeping awake'));
    return parts.length ? parts.join(' · ') : _('Switchboard');
}

// Page models. `page` is 'bluetooth' | 'nightlight' | 'power'.
function page(id, s, _) {
    _ = _ || _id;
    s = s || {};
    if (id === 'bluetooth' && s.bt && s.bt.available) {
        const b = s.bt;
        const on = !!b.powered && !b.blocked;
        return {
            id, title: _('Bluetooth'), master: on,
            note: on ? (b.devices && b.devices.length ? '' : _('No paired devices.')) : _('Turn Bluetooth on to connect a device.'),
            devices: (b.devices || []).map(d => ({ path: d.path, name: d.name, icon: d.icon || 'bluetooth-active-symbolic',
                                                   connected: on && !!d.connected, sensitive: on }))
        };
    }
    if (id === 'nightlight' && s.night && s.night.available) {
        const n = s.night;
        let status;
        if (!n.enabled) status = _('Off');
        else if (n.paused) status = _('Paused until tomorrow');
        else if (n.until) status = _('On until %s').replace('%s', n.until);
        else status = _('On');
        return {
            id, title: _('Night Light'), master: !!n.enabled && !n.paused, status,
            temperature: n.temperature | 0,
            pauseLabel: n.paused ? _('Turn back on now') : _('Disable until tomorrow'),
            pauseSensitive: !!n.enabled && n.canPause !== false
        };
    }
    if (id === 'power' && s.power && s.power.available) {
        const p = s.power;
        const holds = p.holds || [];
        let note = '';
        if (holds.length) note = _('%s asked for this mode. Picking another one ends its request.').replace('%s', holds[0].appId || _('An application'));
        else if (!(p.profiles || []).includes('performance')) note = _('Performance needs a CPU driver this computer does not have.');
        return {
            id, title: _('Power Mode'), master: null, note,
            profiles: (p.profiles || []).map(pid => ({ id: pid, name: _profileName(pid, _), active: pid === p.active }))
        };
    }
    return null;
}

// "84 %" for the footer, or '' when there is no battery.
function batteryText(battery) {
    if (!battery || !battery.available || typeof battery.percent !== 'number' || !isFinite(battery.percent)) return '';
    return Math.round(battery.percent) + ' %';
}
