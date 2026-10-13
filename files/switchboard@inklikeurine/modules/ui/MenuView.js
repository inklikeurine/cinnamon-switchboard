// MenuView.js — everything inside Switchboard's popup menu.
//
//   body (fixed height, .switchboard-body)
//     main page:  brightness row (when available) + two-column tile grid
//     sub-page:   [‹ Back] / title + master switch / separator / page content
//   separator
//   footer:     System Settings · battery percentage (when there is a battery)
//
// The body has one height for every page and every computer, so the Back
// button, the footer and System Settings never move. MenuView draws what
// render() is given (TileModel output) and reports clicks through `cb`; it
// never talks to a backend.

const St        = imports.gi.St;
const Clutter   = imports.gi.Clutter;
const Pango     = imports.gi.Pango;
const PopupMenu = imports.ui.popupMenu;
const SliderMod = imports.ui.slider;

const Tile = require('./modules/ui/Tile').Tile;

var FALLBACK_ACCENT = 'rgb(12,117,222)';
var MIN_K = 1700;
var MAX_K = 6500;

function _fill(bin) {
    try { bin.x_fill = true; bin.y_fill = true; } catch (e) { /* property not in this St */ }
}

// Clutter clears the stage's key focus when the focused actor is hidden or
// destroyed, and Cinnamon's PopupMenuManager closes the menu as soon as the
// focus is nowhere (popupMenu.js, _onKeyFocusChanged). Focus is therefore
// moved out of anything before it is hidden or rebuilt.
function _hasFocus(container) {
    const focus = global.stage.key_focus;
    return !!focus && container.contains(focus);
}

function _label(text, style) {
    const l = new St.Label({ text: text || '', style_class: style || '', y_align: Clutter.ActorAlign.CENTER });
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

// A full-width row that looks and behaves like a popup menu item.
function _row(iconName, text, onClick) {
    const b = new St.Button({ style_class: 'popup-menu-item switchboard-row', can_focus: true, reactive: true,
                              track_hover: true, x_expand: true });
    _fill(b);
    const box = new St.BoxLayout({ style_class: 'switchboard-row-box', x_expand: true });
    if (iconName) {
        b._icon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, style_class: 'popup-menu-icon',
                                y_align: Clutter.ActorAlign.CENTER });
        box.add_child(b._icon);
    }
    b._label = _label(text);
    b._label.x_expand = true;
    box.add_child(b._label);
    b.set_child(box);
    b._box = box;
    const sync = () => {
        if (b.hover || b.has_key_focus()) b.add_style_pseudo_class('active');
        else b.remove_style_pseudo_class('active');
    };
    b.connect('notify::hover', sync);
    b.connect('key-focus-in', sync);
    b.connect('key-focus-out', sync);
    b.connect('clicked', () => onClick());
    return b;
}

class MenuView {
    constructor(menu, cb, gettext) {
        const _ = gettext;
        this._menu = menu;
        this._cb = cb;
        this._ = _;
        this._accent = null;
        this._pageId = null;
        this._tiles = new Map();       // id → Tile
        this._order = '';
        this._devicesKey = null;
        this._profilesKey = null;

        // ── Body ─────────────────────────────────────────────────────────
        this._bodyItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false, style_class: 'switchboard-body-item' });
        this._body = new St.BoxLayout({ vertical: true, style_class: 'switchboard-body', x_expand: true });
        this._bodyItem.addActor(this._body, { span: -1, expand: true });
        menu.addMenuItem(this._bodyItem);
        this._body.connect('key-press-event', (actor, event) => {
            if (this._pageId && event.get_key_symbol() === Clutter.KEY_Escape) { cb.onBack(); return Clutter.EVENT_STOP; }
            return Clutter.EVENT_PROPAGATE;
        });

        // Main page.
        this._main = new St.BoxLayout({ vertical: true, style_class: 'switchboard-main', x_expand: true });
        this._brightRow = new St.BoxLayout({ style_class: 'switchboard-brightness', x_expand: true });
        this._brightRow.add_child(new St.Icon({ icon_name: 'display-brightness-symbolic', icon_type: St.IconType.SYMBOLIC,
                                                style_class: 'popup-menu-icon', y_align: Clutter.ActorAlign.CENTER }));
        this._brightSlider = new SliderMod.Slider(0.5);
        this._brightSlider.actor.x_expand = true;
        this._brightSlider.actor.y_align = Clutter.ActorAlign.CENTER;
        this._brightSlider.actor.can_focus = true;
        this._brightSlider.actor.accessible_name = _('Brightness');
        this._brightSlider.connect('value-changed', (s, v) => cb.onBrightness(Math.round(v * 100)));
        this._brightRow.add_child(this._brightSlider.actor);
        this._main.add_child(this._brightRow);

        this._gridLayout = new Clutter.GridLayout({ column_homogeneous: true, row_homogeneous: true });
        this._gridLayout.set_column_spacing(8);
        this._gridLayout.set_row_spacing(8);
        this._grid = new St.Widget({ layout_manager: this._gridLayout, style_class: 'switchboard-grid', x_expand: true });
        this._main.add_child(this._grid);
        this._body.add_child(this._main);

        // Sub-page frame.
        this._sub = new St.BoxLayout({ vertical: true, style_class: 'switchboard-page', x_expand: true, visible: false });
        const backRow = new St.BoxLayout({ style_class: 'switchboard-back-row' });
        this._back = new St.Button({ style_class: 'switchboard-back', can_focus: true, reactive: true, track_hover: true });
        const backBox = new St.BoxLayout({ style_class: 'switchboard-back-box' });
        backBox.add_child(new St.Icon({ icon_name: 'go-previous-symbolic', icon_type: St.IconType.SYMBOLIC, icon_size: 16,
                                        y_align: Clutter.ActorAlign.CENTER }));
        backBox.add_child(_label(_('Back')));
        this._back.set_child(backBox);
        this._back.accessible_name = _('Back to Switchboard');
        this._back.connect('clicked', () => cb.onBack());
        backRow.add_child(this._back);
        this._sub.add_child(backRow);

        const header = new St.BoxLayout({ style_class: 'switchboard-page-header', x_expand: true });
        this._pageTitle = _label('', 'switchboard-page-title');
        this._pageTitle.x_expand = true;
        header.add_child(this._pageTitle);
        this._masterSwitch = new PopupMenu.Switch(false);
        // St.Bin's own x_align/y_align take St.Align, not Clutter.ActorAlign; the
        // header row centres its children vertically anyway.
        this._masterBtn = new St.Button({ style_class: 'switchboard-switch-button', can_focus: true, reactive: true,
                                          child: this._masterSwitch.actor });
        this._masterBtn.connect('clicked', () => { if (this._pageId) cb.onMaster(this._pageId); });
        header.add_child(this._masterBtn);
        this._sub.add_child(header);
        this._sub.add_child(new St.Widget({ style_class: 'switchboard-separator', x_expand: true }));

        // Bluetooth page.
        this._btSection = new St.BoxLayout({ vertical: true, x_expand: true });
        this._btSection.add_child(_label(_('Paired devices'), 'switchboard-section-title'));
        this._btNote = _label('', 'switchboard-note');
        this._btSection.add_child(this._btNote);
        this._btDevices = new St.BoxLayout({ vertical: true, x_expand: true });
        this._btSection.add_child(this._btDevices);
        this._btSettings = _row('preferences-system-symbolic', _('Bluetooth Settings'), () => cb.openBluetoothSettings());
        this._btSection.add_child(this._btSettings);
        this._sub.add_child(this._btSection);

        // Night Light page.
        this._nightSection = new St.BoxLayout({ vertical: true, x_expand: true });
        this._nightStatus = _label('', 'switchboard-note');
        this._nightSection.add_child(this._nightStatus);
        this._tempBox = new St.BoxLayout({ vertical: true, x_expand: true });
        const tempHead = new St.BoxLayout({ style_class: 'switchboard-temp-head', x_expand: true });
        const tempTitle = _label(_('Colour temperature'), 'switchboard-section-title');
        tempTitle.x_expand = true;
        tempHead.add_child(tempTitle);
        this._tempValue = _label('', 'switchboard-note');
        tempHead.add_child(this._tempValue);
        this._tempBox.add_child(tempHead);
        const tempRow = new St.BoxLayout({ style_class: 'switchboard-temp-row', x_expand: true });
        tempRow.add_child(_label(_('Warm'), 'switchboard-note'));
        this._tempSlider = new SliderMod.Slider(0.5);
        this._tempSlider.actor.x_expand = true;
        this._tempSlider.actor.y_align = Clutter.ActorAlign.CENTER;
        this._tempSlider.actor.can_focus = true;
        this._tempSlider.actor.accessible_name = _('Colour temperature');
        this._tempSlider.connect('value-changed', (s, v) => {
            const k = Math.round((MIN_K + v * (MAX_K - MIN_K)) / 100) * 100;
            this._tempValue.text = k + ' K';
            cb.onTemperature(k);
        });
        tempRow.add_child(this._tempSlider.actor);
        tempRow.add_child(_label(_('Cool'), 'switchboard-note'));
        this._tempBox.add_child(tempRow);
        this._nightSection.add_child(this._tempBox);
        this._pauseRow = _row('media-playback-pause-symbolic', '', () => cb.onPause());
        this._nightSection.add_child(this._pauseRow);
        this._nightSection.add_child(_row('preferences-system-symbolic', _('Night Light Settings'), () => cb.openNightLightSettings()));
        this._sub.add_child(this._nightSection);

        // Power Mode page.
        this._powerSection = new St.BoxLayout({ vertical: true, x_expand: true });
        this._profiles = new St.BoxLayout({ vertical: true, x_expand: true });
        this._powerSection.add_child(this._profiles);
        this._powerNote = _label('', 'switchboard-note switchboard-power-note');
        this._powerNote.clutter_text.line_wrap = true;
        this._powerNote.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._powerSection.add_child(this._powerNote);
        this._sub.add_child(this._powerSection);

        this._body.add_child(this._sub);

        // ── Footer ───────────────────────────────────────────────────────
        this._separator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(this._separator);
        this._settingsItem = new PopupMenu.PopupIconMenuItem(_('System Settings'), 'preferences-system-symbolic', St.IconType.SYMBOLIC);
        this._battery = new St.BoxLayout({ style_class: 'switchboard-battery' });
        this._batteryIcon = new St.Icon({ icon_name: 'battery-good-symbolic', icon_type: St.IconType.SYMBOLIC, style_class: 'popup-menu-icon',
                                          y_align: Clutter.ActorAlign.CENTER });
        this._batteryLabel = _label('', 'switchboard-battery-label');
        this._battery.add_child(this._batteryIcon);
        this._battery.add_child(this._batteryLabel);
        this._settingsItem.addActor(this._battery, { span: -1, expand: true, align: St.Align.END });
        this._settingsItem.connect('activate', () => cb.openSystemSettings());
        menu.addMenuItem(this._settingsItem);

        this._openId = menu.connect('open-state-changed', (m, open) => { if (open) this._sampleAccent(); });
    }

    // The theme's selection colour: Mint-Y (and Cinnamon's default theme)
    // paint the filled part of a slider with it.
    _sampleAccent() {
        let accent = FALLBACK_ACCENT;
        const probe = new St.Widget({ style_class: 'popup-slider-menu-item', opacity: 0, width: 1, height: 1 });
        this._body.add_child(probe);
        try {
            const [ok, c] = probe.get_theme_node().lookup_color('-slider-active-background-color', false);
            if (ok && c) accent = 'rgb(' + c.red + ',' + c.green + ',' + c.blue + ')';
        } catch (e) { /* theme without the property */ }
        probe.destroy();
        if (accent !== this._accent) {
            this._accent = accent;
            this._cb.onAccentChanged();
        }
    }

    get pageId() {
        return this._pageId;
    }

    render(v) {
        const _ = this._;

        // Tiles: update in place, re-attach only when the visible set or order changes.
        for (const t of v.tiles) {
            let tile = this._tiles.get(t.id);
            if (!tile) {
                tile = new Tile({ iconFor: this._cb.iconFor, onToggle: id => this._cb.onToggle(id), onArrow: id => this._cb.onArrow(id) });
                this._tiles.set(t.id, tile);
            }
            tile.update(t, this._accent);
        }
        const order = v.tiles.map(t => t.id).join(',');
        if (order !== this._order) {
            this._order = order;
            for (const child of this._grid.get_children()) this._grid.remove_child(child);
            v.tiles.forEach((t, i) => this._gridLayout.attach(this._tiles.get(t.id).actor, i % 2, Math.floor(i / 2), 1, 1));
        }

        // Brightness.
        this._brightRow.visible = !!v.brightness.visible;
        if (v.brightness.visible && !this._brightSlider._dragging)
            this._brightSlider.setValue(Math.max(0, Math.min(1, v.brightness.percent / 100)));

        // Page. The page being shown is made visible first and takes the
        // focus; only then is the other one hidden (see _hasFocus).
        const page = v.page;
        const wasPage = this._pageId;
        this._pageId = page ? page.id : null;
        if (!page) {
            this._main.visible = true;
            if (this._menu.isOpen && _hasFocus(this._sub)) this._focusTile(wasPage);
            this._sub.visible = false;
        } else {
            this._sub.visible = true;
            if (wasPage !== page.id) this._back.grab_key_focus();
            this._main.visible = false;
            this._btSection.visible = page.id === 'bluetooth';
            this._nightSection.visible = page.id === 'nightlight';
            this._powerSection.visible = page.id === 'power';
            this._pageTitle.text = page.title;
            this._masterBtn.visible = page.master !== null && page.master !== undefined;
            if (this._masterBtn.visible) {
                this._masterSwitch.setToggleState(!!page.master);
                this._masterBtn.accessible_name = page.title;
            }
            if (page.id === 'bluetooth') this._renderBluetooth(page, v);
            else if (page.id === 'nightlight') this._renderNight(page, v);
            else if (page.id === 'power') this._renderPower(page);
        }

        // Footer battery: always shown when the computer has a battery.
        this._battery.visible = !!v.battery.text;
        this._batteryLabel.text = v.battery.text;
        this._batteryIcon.icon_name = v.battery.icon || 'battery-good-symbolic';
    }

    // Back: focus returns to the tile that opened the page, or to the menu.
    _focusTile(id) {
        const tile = id ? this._tiles.get(id) : null;
        const target = tile ? tile.focusTarget() : null;
        (target || this._menu.actor).grab_key_focus();
    }

    // Before a row list is rebuilt: if it holds the focus, park the focus on
    // the menu and return the focused row's position, else -1.
    _parkFocus(box) {
        if (!_hasFocus(box)) return -1;
        const focus = global.stage.key_focus;
        const index = box.get_children().findIndex(c => c.contains(focus));
        this._menu.actor.grab_key_focus();
        return index;
    }

    // After the rebuild: focus the row now at that position (or the last one).
    _restoreFocus(box, index) {
        if (index < 0) return;
        const n = box.get_n_children();
        const row = n ? box.get_child_at_index(Math.min(index, n - 1)) : null;
        if (row && row.can_focus) row.grab_key_focus();
    }

    _renderBluetooth(page, v) {
        this._btNote.text = page.note;
        this._btNote.visible = !!page.note;
        this._btSettings.visible = !!v.bluetoothSettings;
        const key = page.devices.map(d => d.path + '|' + d.name + '|' + d.connected + '|' + d.sensitive).join(';');
        if (key === this._devicesKey) return;
        this._devicesKey = key;
        const focused = this._parkFocus(this._btDevices);
        this._btDevices.destroy_all_children();
        for (const d of page.devices) {
            const row = _row(d.icon, d.name, () => this._cb.onDevice(d.path, !d.connected));
            const sw = new PopupMenu.Switch(d.connected);
            row._box.add_child(sw.actor);
            row.reactive = d.sensitive;
            row.can_focus = d.sensitive;
            row.opacity = d.sensitive ? 255 : 128;
            row.accessible_name = d.name;
            this._btDevices.add_child(row);
        }
        this._restoreFocus(this._btDevices, focused);
    }

    _renderNight(page, v) {
        this._nightStatus.text = page.status;
        this._tempBox.visible = !!v.showTemperatureSlider;
        if (!this._tempSlider._dragging && page.temperature) {
            this._tempSlider.setValue((page.temperature - MIN_K) / (MAX_K - MIN_K));
            this._tempValue.text = page.temperature + ' K';
        }
        this._pauseRow._label.text = page.pauseLabel;
        this._pauseRow.reactive = page.pauseSensitive;
        this._pauseRow.can_focus = page.pauseSensitive;
        this._pauseRow.opacity = page.pauseSensitive ? 255 : 128;
    }

    _renderPower(page) {
        this._powerNote.text = page.note;
        this._powerNote.visible = !!page.note;
        const key = page.profiles.map(p => p.id + (p.active ? '*' : '')).join(',');
        if (key === this._profilesKey) return;
        this._profilesKey = key;
        const focused = this._parkFocus(this._profiles);
        this._profiles.destroy_all_children();
        for (const p of page.profiles) {
            const row = _row(null, p.name, () => this._cb.onProfile(p.id));
            const dot = _label(p.active ? '●' : '', 'switchboard-dot');
            row._box.insert_child_at_index(dot, 0);
            row.accessible_name = p.name + (p.active ? ', ' + this._('selected') : '');
            this._profiles.add_child(row);
        }
        this._restoreFocus(this._profiles, focused);
    }

    destroy() {
        if (this._openId) { this._menu.disconnect(this._openId); this._openId = 0; }
        this._tiles.clear();
        this._bodyItem.destroy();
        this._separator.destroy();
        this._settingsItem.destroy();
        this._menu = null;
    }
}
