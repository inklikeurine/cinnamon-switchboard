// switchboard@inklikeurine: TileModel (pure) — every tile's mapping for on,
// off, unavailable and held states, the order setting, pages, tooltip and
// battery text. Runs headless: cjs <this> <appletDir> <harnessDir> <testsDir>
imports.searchPath.unshift(ARGV[1]);
const T = imports.lib;
const require = T.makeRequire(ARGV[0]);
const M = require('./modules/TileModel');

const desktop = () => ({
    wifi: { available: true, present: true, enabled: true, hwEnabled: true, ssid: 'MyNetwork', wired: false },
    bt: { available: true, powered: false, blocked: false, devices: [
        { path: '/org/bluez/hci0/dev_A', name: 'Headphones', icon: 'audio-headphones-symbolic', connected: true },
        { path: '/org/bluez/hci0/dev_B', name: 'Travel mouse', icon: 'input-mouse-symbolic', connected: false }] },
    night: { available: true, enabled: true, active: true, paused: false, until: '06:00', temperature: 4000, canPause: true },
    dnd: { available: true, active: false },
    power: { available: true, active: 'balanced', profiles: ['power-saver', 'balanced'], holds: [] },
    awake: { available: true, on: false, heldBy: '' }
});
const byId = (tiles, id) => tiles.find(t => t.id === id);

T.run('order: default, user order, unknown and missing names', () => {
    T.eq(M.order(M.defaultSetting()).map(r => r.id), M.TILE_IDS, 'default order');
    const o = M.order([{ tile: 'Keep Awake', enabled: true }, { tile: 'wi-fi', enabled: false }, { tile: 'Teleporter', enabled: true }, { tile: 'Keep Awake', enabled: false }]);
    T.eq(o.map(r => r.id), ['awake', 'wifi', 'bluetooth', 'nightlight', 'dnd', 'power'], 'user order first, rest appended');
    T.eq(o[1].enabled, false, 'hidden tile stays hidden');
    T.eq(o[0].enabled, true, 'duplicate ignored');
    T.eq(M.order(null).length, 6, 'no setting → all six');
});

T.run('desktop: every tile and its status', () => {
    const t = M.tiles(desktop(), M.defaultSetting());
    T.eq(t.map(x => x.id), M.TILE_IDS, 'all six visible');
    T.eq([byId(t, 'wifi').status, byId(t, 'wifi').checked, byId(t, 'wifi').arrow], ['MyNetwork', true, 'page'], 'wifi');
    T.eq(byId(t, 'wifi').launch, undefined, 'wifi opens its page (0.2.0), not Network Settings');
    T.eq([byId(t, 'bluetooth').status, byId(t, 'bluetooth').checked, byId(t, 'bluetooth').arrow], ['Off', false, 'page'], 'bluetooth off');
    T.eq([byId(t, 'nightlight').status, byId(t, 'nightlight').checked], ['On until 06:00', true], 'night light');
    T.eq([byId(t, 'dnd').status, byId(t, 'dnd').launch], ['Off', 'cinnamon-settings notifications'], 'dnd');
    T.eq([byId(t, 'power').status, byId(t, 'power').checked, byId(t, 'power').opensPage], ['Balanced', false, true], 'power balanced is not highlighted');
    T.eq([byId(t, 'awake').status, byId(t, 'awake').arrow], ['Off', null], 'keep awake has no arrow');
});

T.run('on, held, blocked, paused and hardware-off states', () => {
    const s = desktop();
    s.wifi.hwEnabled = false;
    s.bt.blocked = true;
    s.night.paused = true;
    s.dnd.active = true;
    s.power.active = 'power-saver';
    s.power.holds = [{ appId: 'Videos', profile: 'power-saver' }];
    s.awake.heldBy = 'Videos';
    const t = M.tiles(s, null);
    T.eq([byId(t, 'wifi').status, byId(t, 'wifi').sensitive, byId(t, 'wifi').checked], ['Hardware off', false, false], 'wifi hardware off');
    T.eq(byId(t, 'bluetooth').status, 'Blocked', 'bluetooth blocked');
    T.eq([byId(t, 'nightlight').status, byId(t, 'nightlight').checked], ['Paused', false], 'night light paused');
    T.eq(byId(t, 'dnd').checked, true, 'dnd on');
    T.eq([byId(t, 'power').status, byId(t, 'power').checked], ['Held by Videos', true], 'power held');
    T.eq(byId(t, 'awake').status, 'Held by Videos', 'someone else keeps the screen on');
    s.awake.on = true;
    T.eq(M.tile('awake', s).status, 'Screen stays on', 'ours wins');
    s.bt.blocked = false; s.bt.powered = true;
    T.eq(M.tile('bluetooth', s).status, '1 connected', 'one device');
    s.bt.devices[1].connected = true;
    T.eq(M.tile('bluetooth', s).status, '2 connected', 'two devices');
    s.wifi.hwEnabled = true; s.wifi.enabled = false;
    T.eq(M.tile('wifi', s).status, 'Off', 'wifi off');
    s.wifi.enabled = true; s.wifi.ssid = '';
    T.eq(M.tile('wifi', s).status, 'Not connected', 'wifi on, no network');
});

T.run('unavailable backends hide their tiles; the grid reflows', () => {
    const s = desktop();
    s.bt = { available: false };
    s.power = { available: false };
    T.eq(M.tiles(s, null).map(x => x.id), ['wifi', 'nightlight', 'dnd', 'awake'], 'four tiles');
    s.wifi = { available: true, present: false, wired: true };
    T.eq([M.tile('wifi', s).status, M.tile('wifi', s).sensitive], ['Wired', false], 'wired-only machine');
    T.eq([M.tile('wifi', s).arrow, M.tile('wifi', s).launch], ['launch', 'cinnamon-settings network'], 'wired-only: arrow opens Network Settings');
    T.eq(M.page('wifi', s), null, 'no Wi-Fi device: no Wi-Fi page');
    s.wifi = { available: true, present: false, wired: false };
    T.eq(M.tile('wifi', s), null, 'no wifi, no cable → hidden');
    T.eq(M.tiles({}, null), [], 'nothing available → no tiles');
    const hidden = M.defaultSetting(); hidden[3].enabled = false;
    T.ok(!M.tiles(desktop(), hidden).some(x => x.id === 'dnd'), 'user-hidden tile');
});

T.run('pages', () => {
    const s = desktop();
    let p = M.page('bluetooth', s);
    T.eq([p.master, p.note, p.devices.length, p.devices[0].connected, p.devices[0].sensitive], [false, 'Turn Bluetooth on to connect a device.', 2, false, false], 'bluetooth off');
    s.bt.powered = true;
    p = M.page('bluetooth', s);
    T.eq([p.master, p.note, p.devices[0].connected, p.devices[1].sensitive], [true, '', true, true], 'bluetooth on');
    p = M.page('nightlight', s);
    T.eq([p.master, p.status, p.temperature, p.pauseLabel, p.pauseSensitive], [true, 'On until 06:00', 4000, 'Disable until tomorrow', true], 'night light');
    s.night.paused = true;
    T.eq([M.page('nightlight', s).status, M.page('nightlight', s).pauseLabel], ['Paused until tomorrow', 'Turn back on now'], 'paused');
    s.night.canPause = false;
    T.eq(M.page('nightlight', s).pauseSensitive, false, 'no csd-color → cannot pause');
    p = M.page('power', s);
    T.eq(p.master, null, 'power page has no master switch');
    T.eq(p.profiles.map(x => [x.id, x.active]), [['power-saver', false], ['balanced', true]], 'profiles');
    T.eq(p.note, 'Performance needs a CPU driver this computer does not have.', 'why performance is missing');
    s.power.holds = [{ appId: 'Videos', profile: 'balanced' }];
    T.eq(M.page('power', s).note, 'Videos asked for this mode. Picking another one ends its request.', 'hold note');
    s.power.profiles = ['power-saver', 'balanced', 'performance']; s.power.holds = [];
    T.eq(M.page('power', s).note, '', 'laptop with performance: no note');
    s.bt = { available: false };
    T.eq(M.page('bluetooth', s), null, 'page of a vanished backend');
});

T.run('tooltip', () => {
    const s = desktop();
    T.eq(M.tooltip(s), 'Wi-Fi: MyNetwork · Bluetooth off · Night Light on · DND off · Balanced', 'desktop summary');
    s.dnd.active = true; s.awake.on = true; s.bt.powered = true; s.night.enabled = false;
    T.eq(M.tooltip(s), 'Wi-Fi: MyNetwork · Bluetooth: 1 connected · DND on · Balanced · Keeping awake', 'changed state');
    T.eq(M.tooltip({}), 'Switchboard', 'nothing available');
});

T.run('battery text: shown whenever there is a battery', () => {
    T.eq(M.batteryText({ available: true, percent: 83.6 }), '84 %', 'rounded');
    T.eq(M.batteryText({ available: false }), '', 'desktop');
    T.eq(M.batteryText({ available: true, percent: NaN }), '', 'bad value');
    T.eq(M.batteryText(null), '', 'missing');
});

T.run('translation function is applied', () => {
    const de = s => ({ 'Do Not Disturb': 'Bitte nicht stören', 'On until %s': 'An bis %s' })[s] || s;
    T.eq(M.tile('dnd', desktop(), de).title, 'Bitte nicht stören', 'title');
    T.eq(M.tile('nightlight', desktop(), de).status, 'An bis 06:00', 'template filled after translation');
});

T.run('wifi page (0.2.0)', () => {
    const nets = [
        { ssid: 'Home', strength: 90, security: 'psk', active: true, connecting: false, known: true },
        { ssid: 'Cafe', strength: 40, security: 'none', active: false, connecting: false, known: false },
        { ssid: 'Office', strength: 60, security: 'enterprise', active: false, connecting: true, known: false }
    ];
    const w = { available: true, present: true, enabled: true, hwEnabled: true, ssid: 'Home', wired: false, networks: nets };
    const p = M.page('wifi', { wifi: w });
    T.eq([p.title, p.master, p.masterSensitive, p.note], ['Wi-Fi', true, true, ''], 'header');
    T.eq(p.networks.map(n => [n.name, n.icon, n.secure, n.status]), [
        ['Home', 'network-wireless-signal-excellent-symbolic', true, 'Connected'],
        ['Cafe', 'network-wireless-signal-ok-symbolic', false, ''],
        ['Office', 'network-wireless-signal-good-symbolic', true, 'Connecting…']], 'rows in backend order');
    T.eq(M.page('wifi', { wifi: Object.assign({}, w, { networks: [] }) }).note, 'Looking for networks…', 'empty list');
    const off = M.page('wifi', { wifi: Object.assign({}, w, { enabled: false }) });
    T.eq([off.master, off.networks.length, off.note], [false, 0, 'Turn Wi-Fi on to see networks.'], 'Wi-Fi off: no list');
    const hw = M.page('wifi', { wifi: Object.assign({}, w, { hwEnabled: false }) });
    T.eq([hw.master, hw.masterSensitive, hw.note], [false, false, 'Wi-Fi is off at the hardware switch.'], 'hardware off: switch greyed');
    const many = Array.from({ length: 40 }, (x, i) => ({ ssid: 'n' + i, strength: 50, security: 'psk' }));
    T.eq(M.page('wifi', { wifi: Object.assign({}, w, { networks: many }) }).networks.length, M.MAX_NETWORKS, 'capped');
});

T.run('signalIcon follows Cinnamon\'s thresholds', () => {
    T.eq([100, 81, 80, 56, 55, 31, 30, 6, 5, 0].map(v => M.signalIcon(v).split('-')[3]),
         ['excellent', 'excellent', 'good', 'good', 'ok', 'ok', 'weak', 'weak', 'none', 'none'], 'levels');
});

T.exit();
