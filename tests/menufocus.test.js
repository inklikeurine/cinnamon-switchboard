// switchboard@inklikeurine: keyboard focus never vanishes while the menu
// changes page or rebuilds a row list (0.1.1).
//
// Clutter clears the stage's key focus when the focused actor is hidden or
// destroyed, and Cinnamon's PopupMenuManager closes the menu when the focus is
// nowhere — 0.1.0 closed the whole menu on Back. MenuView and Tile need the
// shell, so their source is evaluated with stub imports and driven against
// fake actors that follow the same focus rule; a null focus counts as a close.
// The live spec (harness.json) checks the same three paths in Cinnamon.
imports.searchPath.unshift(ARGV[1]);
const T = imports.lib;
const appletDir = ARGV[0];

const stage = {
    _focus: null, closes: 0,
    get key_focus() { return this._focus; },
    set key_focus(a) { this._focus = a; if (a === null) this.closes++; }
};

class Actor {
    constructor(name, parent) {
        this.name = name; this.parent = null; this.children = [];
        this._visible = true; this.can_focus = true;
        if (parent) parent.add_child(this);
    }
    add_child(c) { c.parent = this; this.children.push(c); }
    get_children() { return this.children.slice(); }
    get_n_children() { return this.children.length; }
    get_child_at_index(i) { return this.children[i] || null; }
    contains(a) { for (let x = a; x; x = x.parent) if (x === this) return true; return false; }
    get visible() { return this._visible; }
    set visible(v) {
        this._visible = v;
        const f = stage.key_focus;
        if (!v && f && this.contains(f)) stage.key_focus = null;
    }
    grab_key_focus() { stage.key_focus = this; }
    destroy_all_children() {
        const f = stage.key_focus;
        if (f && this.contains(f) && f !== this) stage.key_focus = null;
        this.children = [];
    }
}

// Evaluate a module's source with stub imports; return the named class.
function load(file, name) {
    const src = T.readFile(appletDir + '/' + file);
    const stubImports = {
        gi: { St: {}, Clutter: { KEY_Escape: 0xff1b, ActorAlign: {} }, Pango: { EllipsizeMode: {} } },
        ui: { popupMenu: {}, slider: {} }
    };
    const stubRequire = () => ({ Tile: class {} });
    return new Function('imports', 'require', 'global', src + '\nreturn ' + name + ';')(stubImports, stubRequire, { stage });
}

const MenuView = load('modules/ui/MenuView.js', 'MenuView');
const Tile = load('modules/ui/Tile.js', 'Tile');

// The parts of a MenuView that render() touches when no tile changes and
// the page has no section of its own.
function view(menuOpen) {
    const menu = new Actor('menu');
    const body = new Actor('body', menu);
    const v = Object.create(MenuView.prototype);
    Object.assign(v, {
        _menu: { isOpen: menuOpen, actor: menu }, _: s => s, _order: '', _tiles: new Map(),
        _main: new Actor('main', body), _sub: new Actor('sub', body),
        _brightRow: {}, _brightSlider: { _dragging: false, setValue() {} },
        _battery: {}, _batteryLabel: {}, _batteryIcon: {},
        _wifiSection: {}, _btSection: {}, _nightSection: {}, _powerSection: {}, _pageTitle: {},
        _masterBtn: {}, _masterSwitch: { setToggleState() {} }
    });
    v._back = new Actor('back', v._sub);
    const tile = new Actor('tile', v._main);
    const arrow = new Actor('arrow', tile);
    v._tiles.set('test', { focusTarget: () => arrow });
    return { v, menu, arrow };
}
const frame = page => ({ tiles: [], brightness: { visible: false }, battery: { text: '' }, page });
const PAGE = { id: 'test', title: 'Test', master: null };   // no section of its own

T.run('Back: focus moves to the tile that opened the page, the menu stays open', () => {
    const { v, arrow } = view(true);
    stage.closes = 0;
    v.render(frame(PAGE));
    T.ok(stage.key_focus === v._back, 'entering a page focuses Back');
    v.render(frame(null));
    T.eq(stage.closes, 0, 'focus never went nowhere (0.1.0: the menu closed here)');
    T.ok(stage.key_focus === arrow, 'focus is on the tile arrow');
    T.ok(v._main.visible && !v._sub.visible, 'main page shown, sub-page hidden');
});

T.run('a focused arrow strip opens its page without losing the focus', () => {
    const { v, arrow } = view(true);
    stage.closes = 0;
    arrow.grab_key_focus();
    v.render(frame(PAGE));
    T.eq(stage.closes, 0, 'focus never went nowhere');
    T.ok(stage.key_focus === v._back, 'Back has the focus');
    T.ok(!v._main.visible && v._sub.visible, 'sub-page shown, main page hidden');
});

T.run('Back with no tile to return to parks the focus on the menu', () => {
    const { v, menu } = view(true);
    v._tiles.clear();
    stage.closes = 0;
    v.render(frame(PAGE));
    v.render(frame(null));
    T.eq(stage.closes, 0, 'focus never went nowhere');
    T.ok(stage.key_focus === menu, 'focus on the menu actor');
});

T.run('closed menu: focus is left alone', () => {
    const { v, menu } = view(false);
    menu.grab_key_focus();
    v._pageId = 'test';
    v.render(frame(null));
    T.ok(stage.key_focus === menu, 'no focus grab while the menu is closed');
});

T.run('rebuilding a row list keeps the focus on the same position', () => {
    const { v, menu } = view(true);
    const box = new Actor('rows', v._sub);
    const old = [0, 1, 2].map(i => new Actor('old' + i, box));
    old[1].grab_key_focus();
    stage.closes = 0;
    const at = v._parkFocus(box);
    T.eq(at, 1, 'position of the focused row');
    T.ok(stage.key_focus === menu, 'parked on the menu during the rebuild');
    box.destroy_all_children();
    const fresh = [0, 1, 2].map(i => new Actor('new' + i, box));
    v._restoreFocus(box, at);
    T.eq(stage.closes, 0, 'focus never went nowhere');
    T.ok(stage.key_focus === fresh[1], 'same position after the rebuild');

    // Fewer rows than before: the last one; an unfocusable row: stay parked.
    fresh[2].grab_key_focus();
    const at2 = v._parkFocus(box);
    box.destroy_all_children();
    const one = new Actor('only', box);
    v._restoreFocus(box, at2);
    T.ok(stage.key_focus === one, 'clamped to the last row');
    one.grab_key_focus();
    const at3 = v._parkFocus(box);
    box.destroy_all_children();
    new Actor('insensitive', box).can_focus = false;
    v._restoreFocus(box, at3);
    T.ok(stage.key_focus === menu, 'unfocusable row: focus stays on the menu');

    // Focus elsewhere: nothing to park.
    v._back.grab_key_focus();
    T.eq(v._parkFocus(box), -1, 'focus outside the list');
    T.ok(stage.key_focus === v._back, 'focus untouched');
});

T.run('Tile.focusTarget: arrow when shown, else the main button if focusable', () => {
    const arrow = { visible: true }, main = { can_focus: true };
    const t = Object.create(Tile.prototype);
    Object.assign(t, { _arrow: arrow, _main: main });
    T.ok(t.focusTarget() === arrow, 'arrow');
    arrow.visible = false;
    T.ok(t.focusTarget() === main, 'main button');
    main.can_focus = false;
    T.ok(t.focusTarget() === null, 'nothing focusable');
});

T.exit();
