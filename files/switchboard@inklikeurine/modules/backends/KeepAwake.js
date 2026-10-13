// KeepAwake.js — the Keep Awake tile: one session inhibitor of our own
// (idle, flag 8 — what inhibit@cinnamon.org uses) and the list of everyone
// else's, from the shared Inhibitors module.
//
//   const awake = new KeepAwake();  // emits 'changed' as the inhibitor list arrives
//   awake.state → { available, on, heldBy }   heldBy = another app keeping the screen on
//   awake.setOn(bool)
//   awake.destroy()                  // releases our inhibitor: a reload never leaves the machine inhibited

const Gio     = imports.gi.Gio;
const GLib    = imports.gi.GLib;
const Signals = imports.signals;

const InhibitorsModule = require('./modules/shared/Inhibitors');

var APP_ID = 'switchboard';
var REASON = 'Keep awake';

class KeepAwake {
    constructor() {
        this._inhibitors = null;
        this._cookie = 0;
        this._pending = false;
        this._wantOn = false;
        this._destroyed = false;
        InhibitorsModule.Inhibitors.create().then(inh => {
            if (this._destroyed) { inh.destroy(); return; }
            this._inhibitors = inh;
            inh.onChanged(() => this.emit('changed'));
            this.emit('changed');
        }, e => {
            global.logWarning('[switchboard] session inhibitors unavailable: ' + e.message);
            this.emit('changed');
        });
    }

    get state() {
        const inh = this._inhibitors;
        if (this._destroyed || !inh || !inh.available) return { available: false };
        const other = inh.list.find(e => (e.flags & InhibitorsModule.Flags.IDLE) && e.appId !== APP_ID);
        return { available: true, on: this._cookie !== 0 || (this._pending && this._wantOn), heldBy: other ? other.appId : '' };
    }

    setOn(on) {
        if (this._destroyed) return;
        this._wantOn = !!on;
        if (this._pending) return;           // the reply re-checks _wantOn
        if (on && !this._cookie) this._inhibit();
        else if (!on && this._cookie) this._uninhibit();
    }

    _inhibit() {
        this._pending = true;
        this.emit('changed');
        const params = new GLib.Variant('(susu)', [APP_ID, 0, REASON, InhibitorsModule.Flags.IDLE]);
        Gio.DBus.session.call(InhibitorsModule.NAME, InhibitorsModule.PATH, InhibitorsModule.IFACE, 'Inhibit', params, null,
            Gio.DBusCallFlags.NONE, 5000, null, (c, res) => {
                this._pending = false;
                let cookie = 0;
                try { [cookie] = c.call_finish(res).deep_unpack(); }
                catch (e) { global.logWarning('[switchboard] Keep Awake failed: ' + e.message); this.emit('changed'); return; }
                if (this._destroyed || !this._wantOn) { KeepAwake.release(cookie); if (!this._destroyed) this.emit('changed'); return; }
                this._cookie = cookie;
                this.emit('changed');
            });
    }

    _uninhibit() {
        const cookie = this._cookie;
        this._cookie = 0;
        KeepAwake.release(cookie);
        this.emit('changed');
    }

    static release(cookie) {
        if (!cookie) return;
        Gio.DBus.session.call(InhibitorsModule.NAME, InhibitorsModule.PATH, InhibitorsModule.IFACE, 'Uninhibit',
            new GLib.Variant('(u)', [cookie]), null, Gio.DBusCallFlags.NONE, 5000, null, (c, res) => {
                try { c.call_finish(res); } catch (e) { /* session manager gone */ }
            });
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._wantOn = false;
        if (this._cookie) { KeepAwake.release(this._cookie); this._cookie = 0; }
        if (this._inhibitors) { this._inhibitors.destroy(); this._inhibitors = null; }
        this.disconnectAll();
    }
}
Signals.addSignalMethods(KeepAwake.prototype);
