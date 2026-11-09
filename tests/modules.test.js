// switchboard@inklikeurine: every module parses, ends with a newline and
// exports what applet.js requires (Cinnamon's loader exports top-level
// declarations). Modules that need the shell (St, imports.ui) are only parsed.
imports.searchPath.unshift(ARGV[1]);
const T = imports.lib;
const appletDir = ARGV[0];

const files = ['applet.js', 'modules/TileModel.js', 'modules/ui/Tile.js', 'modules/ui/MenuView.js',
               'modules/backends/Network.js', 'modules/backends/Bluetooth.js', 'modules/backends/KeepAwake.js',
               'modules/backends/Brightness.js', 'modules/backends/Battery.js'];
const exportsOf = { 'modules/ui/Tile.js': 'Tile', 'modules/ui/MenuView.js': 'MenuView', 'modules/backends/Network.js': 'Network',
                    'modules/backends/Bluetooth.js': 'Bluetooth', 'modules/backends/KeepAwake.js': 'KeepAwake',
                    'modules/backends/Brightness.js': 'Brightness', 'modules/backends/Battery.js': 'Battery' };

T.run('every module parses and ends with a newline', () => {
    for (const f of files) {
        const src = T.readFile(appletDir + '/' + f);
        T.ok(T.parses(src), 'parses: ' + f);
        T.ok(src.endsWith('\n'), 'trailing newline: ' + f);
        if (exportsOf[f]) T.ok(new RegExp('^class ' + exportsOf[f] + '\\b', 'm').test(src), 'exports class ' + exportsOf[f] + ': ' + f);
    }
});

T.run('backends load headless and degrade without a session', () => {
    const require = T.makeRequire(appletDir);
    globalThis.global = globalThis.global || { log() {}, logWarning() {}, logError() {} };
    const Battery = require('./modules/backends/Battery').Battery;
    const Brightness = require('./modules/backends/Brightness').Brightness;
    for (const C of [Battery, Brightness]) {
        const b = new C();
        T.eq(b.state.available, false, C.name + ' unavailable before its bus answers');
        b.destroy();
        T.eq(b.state.available, false, C.name + ' unavailable after destroy');
    }
});

T.exit();
