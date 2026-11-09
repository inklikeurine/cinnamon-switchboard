// switchboard@inklikeurine: Bluetooth backend — a device paired with several
// adapters is one Device1 object per adapter (same Address) and must be
// listed once (0.1.1; owner's speaker on hci0 + hci1 showed twice).
// BlueZ is faked: proxies with cached properties and a recorded call().
imports.searchPath.unshift(ARGV[1]);
const T = imports.lib;
const require = T.makeRequire(ARGV[0]);
const Bluetooth = require('./modules/backends/Bluetooth').Bluetooth;

const calls = [];
function proxy(path, props, failing) {
    return {
        get_object_path: () => path,
        get_cached_property: n => (props[n] === undefined ? null : { deepUnpack: () => props[n] }),
        call(method, params, flags, timeout, cancellable, cb) { calls.push(path + ' ' + method); cb(this, method); },
        call_finish(res) { if (failing && failing.includes(res)) throw new Error(res + ' failed on ' + path); return null; }
    };
}

function backend(adapters, devices) {
    const bt = Object.create(Bluetooth.prototype);
    Object.assign(bt, { _destroyed: false, _busy: false });
    bt._proxies = iface => (iface === 'org.bluez.Adapter1' ? adapters : devices);
    return bt;
}

const HCI0 = '/org/bluez/hci0', HCI1 = '/org/bluez/hci1';
const ADDR = 'AA:BB:CC:00:00:01';
const adapters = [proxy(HCI0, { Powered: true }), proxy(HCI1, { Powered: true })];
const speaker = (hci, connected, failing) => proxy(hci + '/dev_AA_BB_CC_00_00_01',
    { Paired: true, Connected: connected, Address: ADDR, Adapter: hci, Alias: 'Speaker X9', Icon: 'audio-card' }, failing);

T.run('one row per address; connected if any copy is', () => {
    const bt = backend(adapters, [speaker(HCI0, false), speaker(HCI1, true),
        proxy(HCI0 + '/dev_11', { Paired: true, Connected: false, Address: '11', Adapter: HCI0, Alias: 'Mouse' }),
        proxy(HCI0 + '/dev_22', { Paired: false, Address: '22', Adapter: HCI0, Alias: 'Stranger' })]);
    const d = bt.state.devices;
    T.eq(d.map(x => x.name), ['Mouse', 'Speaker X9'], 'speaker once, unpaired device hidden');
    T.eq(d[1].connected, true, 'connected through hci1');
    T.eq(d[1].path, HCI1 + '/dev_AA_BB_CC_00_00_01', 'the row is the connected copy');
});

T.run('not connected: the copy on a powered adapter represents the device', () => {
    const bt = backend([proxy(HCI0, { Powered: false }), proxy(HCI1, { Powered: true })],
                       [speaker(HCI0, false), speaker(HCI1, false)]);
    const d = bt.state.devices;
    T.eq(d.length, 1, 'one row');
    T.eq(d[0].connected, false, 'not connected');
    T.eq(d[0].path, HCI1 + '/dev_AA_BB_CC_00_00_01', 'hci1 (powered) first');
});

T.runAsync('disconnect drops every connected copy', async () => {
    calls.length = 0;
    const bt = backend(adapters, [speaker(HCI0, true), speaker(HCI1, true)]);
    await bt.setDeviceConnected(HCI0 + '/dev_AA_BB_CC_00_00_01', false);
    T.eq(calls.sort(), [HCI0 + '/dev_AA_BB_CC_00_00_01 Disconnect', HCI1 + '/dev_AA_BB_CC_00_00_01 Disconnect'], 'both');
});

T.runAsync('connect falls through to the next adapter when one fails', async () => {
    calls.length = 0;
    const bt = backend(adapters, [speaker(HCI0, false, ['Connect']), speaker(HCI1, false)]);
    await bt.setDeviceConnected(HCI1 + '/dev_AA_BB_CC_00_00_01', true);
    T.eq(calls, [HCI0 + '/dev_AA_BB_CC_00_00_01 Connect', HCI1 + '/dev_AA_BB_CC_00_00_01 Connect'], 'hci0 tried, then hci1');
    calls.length = 0;
    const ok = backend(adapters, [speaker(HCI0, false), speaker(HCI1, false)]);
    await ok.setDeviceConnected(HCI0 + '/dev_AA_BB_CC_00_00_01', true);
    T.eq(calls.length, 1, 'stops at the first adapter that connects');
});

T.exit();
