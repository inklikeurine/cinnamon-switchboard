// Tile.js — one toggle tile: icon, title and status on the left (one button,
// toggles), and for tiles with a page or settings link a full-height arrow
// strip on the right edge (a second button).
//
//   const t = new Tile({ iconFor, onToggle: id => …, onArrow: id => … });
//   t.update(model, accent)   // model from TileModel.tile(); accent = 'rgb(…)' for checked tiles
//   t.actor                   // add to the grid
//   t.destroy()

const St      = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Pango   = imports.gi.Pango;

// St.Bin (and so St.Button) centres its child unless told to fill.
function _fill(bin) {
    try { bin.x_fill = true; bin.y_fill = true; } catch (e) { /* property not in this St */ }
}

class Tile {
    constructor(cb) {
        this._cb = cb;
        this._model = null;

        this.actor = new St.BoxLayout({ style_class: 'switchboard-tile', x_expand: true, y_expand: true });

        this._main = new St.Button({ style_class: 'switchboard-tile-main', x_expand: true, y_expand: true,
                                     can_focus: true, reactive: true, track_hover: true });
        _fill(this._main);
        const box = new St.BoxLayout({ vertical: true, style_class: 'switchboard-tile-content', x_expand: true });
        this._icon = new St.Icon({ style_class: 'switchboard-tile-icon', icon_size: 16, x_align: Clutter.ActorAlign.START });
        this._title = new St.Label({ style_class: 'switchboard-tile-title' });
        this._status = new St.Label({ style_class: 'switchboard-tile-status' });
        for (const l of [this._title, this._status]) l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const spacer = new St.Widget({ y_expand: true });
        box.add_child(this._icon);
        box.add_child(spacer);
        box.add_child(this._title);
        box.add_child(this._status);
        this._main.set_child(box);
        this._main.connect('clicked', () => { if (this._model) this._cb.onToggle(this._model.id); });

        this._arrow = new St.Button({ style_class: 'switchboard-tile-arrow', y_expand: true,
                                      can_focus: true, reactive: true, track_hover: true });
        _fill(this._arrow);
        this._arrow.set_child(new St.Icon({ icon_name: 'pan-end-symbolic', icon_size: 16 }));
        this._arrow.connect('clicked', () => { if (this._model) this._cb.onArrow(this._model.id); });

        this.actor.add_child(this._main);
        this.actor.add_child(this._arrow);
    }

    update(model, accent) {
        this._model = model;
        this._title.text = model.title;
        this._status.text = model.status;
        this._cb.iconFor(this._icon, model.icon);

        const checked = !!model.checked;
        for (const a of [this.actor, this._main, this._arrow]) {
            if (checked) a.add_style_pseudo_class('checked');
            else a.remove_style_pseudo_class('checked');
        }
        // The selection colour comes from the theme (sampled by MenuView); the
        // stylesheet only knows the neutral off colour.
        this.actor.set_style(checked && accent ? 'background-color: ' + accent + '; color: #ffffff;' : null);

        this._main.reactive = model.sensitive !== false;
        this._main.can_focus = model.sensitive !== false;
        this.actor.opacity = model.sensitive === false ? 140 : 255;

        const hasArrow = !!model.arrow;
        this._arrow.visible = hasArrow;
        if (hasArrow) this._main.add_style_class_name('switchboard-has-arrow');
        else this._main.remove_style_class_name('switchboard-has-arrow');
        this._arrow.accessible_name = model.arrow === 'page' ? model.title : model.title + ' settings';
        this._main.accessible_name = model.title + ', ' + model.status;
    }

    // Where keyboard focus returns when this tile's page is closed.
    focusTarget() {
        if (this._arrow.visible) return this._arrow;
        return this._main.can_focus ? this._main : null;
    }

    destroy() {
        this.actor.destroy();
        this._model = null;
    }
}
