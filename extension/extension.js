import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const CACHE = GLib.build_filenamev([GLib.get_home_dir(), '.cache', 'vsphere-desktop-widget', 'hosts.json']);
const POSITION_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'vsphere-desktop-widget', 'position.json']);

function textLabel(value, cssClass) {
    return new St.Label({text: String(value), style_class: cssClass, x_align: Clutter.ActorAlign.START});
}

// Advisory display thresholds only. VMware CPU sensor readings may not be Tcase.
// Host-specific thresholds are keyed by the vCenter host names/IPs.
const TEMPERATURE_THRESHOLDS = {}; // Configure per-host limits locally if needed.

function temperatureClass(host) {
    const temp = host.cpu_temp_c;
    if (typeof temp !== 'number' || !Number.isFinite(temp)) return 'vs-temperature-unknown';
    const limits = TEMPERATURE_THRESHOLDS[String(host.name).trim()] ||
        {warning: 75, critical: 85};
    if (temp >= limits.critical) return 'vs-temperature-critical';
    if (temp >= limits.warning) return 'vs-temperature-warning';
    return 'vs-temperature-normal';
}

function hardwareStatus(value) {
    if (value === 'ok') return ['OK', 'vs-health-ok'];
    if (value === 'warning') return ['WARN', 'vs-health-warning'];
    if (value === 'critical') return ['ALERT', 'vs-health-critical'];
    return ['N/A', 'vs-health-unknown'];
}

function meter(label, value) {
    const group = new St.BoxLayout({vertical: true, style_class: 'vs-meter'});
    const header = new St.BoxLayout({x_expand: true});
    header.add_child(textLabel(label, 'vs-metric-name'));
    const spacer = new St.Widget({x_expand: true});
    header.add_child(spacer);
    header.add_child(textLabel(value === null || value === undefined ? '—' : `${value.toFixed(1)}%`, 'vs-metric-value'));
    group.add_child(header);
    const track = new St.Widget({style_class: 'vs-track', x_expand: true, height: 7});
    // Use a layout with explicit allocation to avoid adjusting bar width before theme allocation.
    track.connect('notify::width', () => {
        const child = track.get_first_child();
        if (child) child.set_width(Math.max(0, Math.round(track.width * Math.max(0, Math.min(100, value ?? 0)) / 100)));
    });
    const fill = new St.Widget({style_class: value !== null && value >= 85 ? 'vs-fill-danger' : value !== null && value >= 70 ? 'vs-fill-warning' : 'vs-fill', height: 7});
    track.add_child(fill);
    group.add_child(track);
    return group;
}

export default class VsphereDesktopWidget extends Extension {
    enable() {
        this._card = new St.BoxLayout({vertical: true, style_class: 'vs-card', reactive: true, track_hover: true});
        this._card.connect('button-press-event', (_actor, event) => this._startDrag(event));
        Main.layoutManager._backgroundGroup.add_child(this._card);
        this._position();
        // GNOME may recreate or reallocate background actors when unlocking.
        // Reapply saved coordinates once layout settles, without changing the file.
        this._queuePositionRestore();
        this._sessionUpdatedId = Main.sessionMode.connect('updated', () => this._queuePositionRestore());
        this._monitorChangedId = Main.layoutManager.connect('monitors-changed', () => this._position());
        this._update();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            this._update();
            // Also heal a background actor moved by Shell during lock/unlock.
            if (!this._dragging && !Main.sessionMode.isLocked) this._position();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _queuePositionRestore() {
        if (this._restoreId) GLib.Source.remove(this._restoreId);
        this._restoreId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
            this._restoreId = 0;
            if (!this._dragging) this._position();
            return GLib.SOURCE_REMOVE;
        });
    }

    _position() {
        if (!this._card) return;
        let monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || this._dragging) return;
        let x = monitor.x + 28;
        let y = monitor.y + 56;
        try {
            const [ok, bytes] = GLib.file_get_contents(POSITION_FILE);
            if (ok) {
                const saved = JSON.parse(new TextDecoder().decode(bytes));
                if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                    x = saved.x;
                    y = saved.y;
                    // Keep a saved position on its original screen if multi-monitor.
                    for (const candidate of Main.layoutManager.monitors) {
                        if (x >= candidate.x && x < candidate.x + candidate.width &&
                            y >= candidate.y && y < candidate.y + candidate.height) {
                            monitor = candidate;
                            break;
                        }
                    }
                }
            }
        } catch (_) { /* first launch, no saved position */ }
        // Keep at least the top part of the card visible after monitor changes.
        x = Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - 80));
        y = Math.max(monitor.y, Math.min(y, monitor.y + monitor.height - 40));
        const px = Math.round(x), py = Math.round(y);
        if (this._card.x !== px || this._card.y !== py)
            this._card.set_position(px, py);
    }

    _startDrag(event) {
        if (event.get_button() !== 1 || this._dragging) return Clutter.EVENT_PROPAGATE;
        const [pointerX, pointerY] = event.get_coords();
        this._dragging = {
            pointerX, pointerY,
            x: this._card.x, y: this._card.y,
        };
        this._stageEventId = global.stage.connect('captured-event', (_stage, ev) => {
            if (!this._dragging || !this._card) return Clutter.EVENT_PROPAGATE;
            const type = ev.type();
            if (type === Clutter.EventType.MOTION) {
                const [mx, my] = ev.get_coords();
                this._card.set_position(
                    Math.round(this._dragging.x + mx - this._dragging.pointerX),
                    Math.round(this._dragging.y + my - this._dragging.pointerY)
                );
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE && ev.get_button() === 1) {
                this._finishDrag(true);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        return Clutter.EVENT_STOP;
    }

    _finishDrag(save) {
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = 0;
        }
        this._dragging = null;
        if (!save || !this._card) return;
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(POSITION_FILE), 0o700);
            GLib.file_set_contents(POSITION_FILE, JSON.stringify({
                x: Math.round(this._card.x),
                y: Math.round(this._card.y),
            }));
        } catch (error) {
            console.warn(`vSphere widget: failed to save position: ${error.message}`);
        }
        this._queuePositionRestore();
    }

    _update() {
        if (!this._card) return;
        for (const child of this._card.get_children()) child.destroy();
        const title = new St.BoxLayout();
        title.add_child(textLabel('◈  vSphere · ESXi HOSTS', 'vs-title'));
        this._card.add_child(title);
        let data;
        try {
            const [ok, bytes] = GLib.file_get_contents(CACHE);
            if (!ok) throw new Error('Cannot read cache');
            data = JSON.parse(new TextDecoder().decode(bytes));
        } catch (_) {
            this._card.add_child(textLabel('Waiting for data…', 'vs-muted'));
            return;
        }
        const timestamp = data.updated ? Date.parse(data.updated) : NaN;
        const stale = !Number.isFinite(timestamp) || Date.now() - timestamp > 120000 || timestamp > Date.now() + 60000;
        if (stale) {
            this._card.add_child(textLabel('● DATA STALE · Last update unavailable/old', 'vs-health-critical'));
            if (Number.isFinite(timestamp))
                this._card.add_child(textLabel(`Last update: ${new Date(timestamp).toLocaleTimeString()}`, 'vs-footer'));
            return;
        }
        if (data.error) {
            this._card.add_child(textLabel('Cannot connect to vCenter', 'vs-error'));
            this._card.add_child(textLabel(String(data.error).slice(0, 85), 'vs-muted'));
            return;
        }
        if (!data.hosts?.length) {
            this._card.add_child(textLabel('No ESXi hosts found', 'vs-muted'));
            return;
        }
        for (const host of data.hosts) {
            const block = new St.BoxLayout({vertical: true, style_class: 'vs-host'});
            const heading = new St.BoxLayout();
            heading.add_child(textLabel(host.name, 'vs-hostname'));
            heading.add_child(new St.Widget({x_expand: true}));
            const online = host.state === 'connected';
            heading.add_child(textLabel(online ? '● ONLINE' : `● ${String(host.state).toUpperCase()}`, online ? 'vs-online' : 'vs-offline'));
            block.add_child(heading);
            block.add_child(meter('CPU', host.cpu));
            block.add_child(meter('RAM', host.ram));
            // Keep the original full-width meters, but put temperature and
            // hardware health together on one line to reduce vertical space.
            const c1 = host.cpu1_temp_c;
            const c2 = host.cpu2_temp_c;
            const asTemp = v => typeof v === 'number' && Number.isFinite(v)
                ? `${v.toFixed(1)}°C` : 'N/A';
            const hw = host.hardware_health || {};
            const [fanText, fanStyle] = hardwareStatus(hw.fans);
            const [powerText, powerStyle] = hardwareStatus(hw.power);
            const infoLine = new St.BoxLayout({style_class: 'vs-info-row', x_expand: true});
            infoLine.add_child(textLabel(
                `CPU1: ${asTemp(c1)} · CPU2: ${asTemp(c2)}`,
                `vs-info-temperature ${temperatureClass(host)}`
            ));
            infoLine.add_child(new St.Widget({x_expand: true}));
            const hwLine = new St.BoxLayout({style_class: 'vs-info-health'});
            hwLine.add_child(textLabel(`Fans: ${fanText}`, `vs-info-health-label ${fanStyle}`));
            hwLine.add_child(textLabel('·', 'vs-info-separator'));
            hwLine.add_child(textLabel(`PSU: ${powerText}`, `vs-info-health-label ${powerStyle}`));
            infoLine.add_child(hwLine);
            block.add_child(infoLine);
            if (host.ram_used_gb !== null && host.ram_total_gb !== null && host.ram_used_gb !== undefined)
                block.add_child(textLabel(`${host.ram_used_gb} / ${host.ram_total_gb} GB`, 'vs-muted'));
            this._card.add_child(block);
        }
        const updated = data.updated ? new Date(data.updated) : null;
        this._card.add_child(textLabel(`Updated: ${updated && !isNaN(updated) ? updated.toLocaleTimeString() : '—'}`, 'vs-footer'));
    }

    disable() {
        this._finishDrag(false);
        if (this._timer) GLib.Source.remove(this._timer);
        if (this._restoreId) GLib.Source.remove(this._restoreId);
        this._restoreId = 0;
        if (this._sessionUpdatedId) Main.sessionMode.disconnect(this._sessionUpdatedId);
        this._sessionUpdatedId = 0;
        this._timer = null;
        if (this._monitorChangedId) Main.layoutManager.disconnect(this._monitorChangedId);
        this._monitorChangedId = null;
        this._card?.destroy();
        this._card = null;
    }
}
