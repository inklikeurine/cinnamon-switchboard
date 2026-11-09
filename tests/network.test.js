// switchboard@inklikeurine: Network.groupNetworks() — access points → one
// entry per network name for the Wi-Fi page (0.2.0). The NetworkManager side
// (scan, connect) is checked live and by hand; nothing here touches NM.
imports.searchPath.unshift(ARGV[1]);
const T = imports.lib;
const N = T.makeRequire(ARGV[0])('./modules/backends/Network');

T.run('one entry per name: strongest signal, strictest security, flags of any access point', () => {
    const g = N.groupNetworks([
        { ssid: 'Home', strength: 40, security: 'psk', known: true },
        { ssid: 'Home', strength: 85, security: 'psk', active: true },      // 5 GHz radio of the same network
        { ssid: 'Mixed', strength: 30, security: 'none' },
        { ssid: 'Mixed', strength: 20, security: 'enterprise' },
        { ssid: '', strength: 99, security: 'psk' },                         // hidden: dropped
        null
    ]);
    T.eq(g.map(n => n.ssid), ['Home', 'Mixed'], 'names');
    T.eq([g[0].strength, g[0].security, g[0].active, g[0].known], [85, 'psk', true, true], 'Home merged');
    T.eq([g[1].strength, g[1].security], [30, 'enterprise'], 'Mixed: strongest signal, strictest security');
});

T.run('order: active, connecting, saved, strongest, then name', () => {
    const g = N.groupNetworks([
        { ssid: 'b-strong', strength: 90 },
        { ssid: 'a-strong', strength: 90 },
        { ssid: 'weak-saved', strength: 10, known: true },
        { ssid: 'joining', strength: 20, connecting: true },
        { ssid: 'current', strength: 15, active: true }
    ]);
    T.eq(g.map(n => n.ssid), ['current', 'joining', 'weak-saved', 'a-strong', 'b-strong'], 'order');
});

T.run('empty and junk input', () => {
    T.eq(N.groupNetworks([]), [], 'empty');
    T.eq(N.groupNetworks(undefined), [], 'undefined');
    T.eq(N.groupNetworks([{ ssid: 'x', strength: 'n/a' }])[0].strength, 0, 'non-numeric strength → 0');
});

T.exit();
