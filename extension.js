/**
 * extension.js
 *
 * Desktop Profiles: a panel button that saves and restores named
 * desktop layouts. Related to the Cinnamon Panel Profiles applet, but
 * a different domain by necessity: GNOME has no movable panels, so a
 * profile captures the enabled extensions, their settings, favorites,
 * and the monitor layout.
 *
 * The capture/apply logic lives in lib/desktopSnapshot.js behind a
 * backend; this file builds the real Gio backend and the panel menu.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { Extension } from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import * as Profiles from './lib/profiles.js';
import * as Snapshot from './lib/desktopSnapshot.js';

function schemaSource() {
    return Gio.SettingsSchemaSource.get_default();
}

function settingsFor(schema) {
    return new Gio.Settings({ settings_schema: schemaSource().lookup(schema, true) });
}

function realBackend() {
    return {
        listExtensionSchemas() {
            const [schemas] = schemaSource().list_schemas(true);
            return schemas.filter(schema => schema.startsWith("org.gnome.shell.extensions."));
        },

        readSchema(schemaId) {
            try {
                const settings = settingsFor(schemaId);
                const values = {};
                for (const key of settings.list_keys()) {
                    if (key === "enabled-extensions" || key === "disabled-extensions" ||
                        key === "favorite-apps")
                        continue;
                    values[key] = settings.get_value(key).print(true);
                }
                return values;
            } catch (e) {
                return null;
            }
        },

        writeSchema(schemaId, values) {
            const settings = settingsFor(schemaId);
            for (const key of Object.keys(values)) {
                const variant = GLib.Variant.parse(null, values[key], null, null);
                settings.set_value(key, variant);
            }
        },

        getEnabledExtensions() {
            return settingsFor(Snapshot.SHELL_SCHEMA).get_strv("enabled-extensions");
        },

        setEnabledExtensions(uuids) {
            settingsFor(Snapshot.SHELL_SCHEMA).set_strv("enabled-extensions", uuids);
        },

        getFavorites() {
            return settingsFor(Snapshot.SHELL_SCHEMA).get_strv("favorite-apps");
        },

        setFavorites(ids) {
            settingsFor(Snapshot.SHELL_SCHEMA).set_strv("favorite-apps", ids);
        },

        readMonitorsXml() {
            try {
                const path = GLib.build_filenamev(
                    [GLib.get_user_config_dir(), "monitors.xml"]);
                const [ok, contents] = GLib.file_get_contents(path);
                if (!ok || !contents)
                    return null;
                return new TextDecoder().decode(contents);
            } catch (e) {
                return null;
            }
        },

        writeMonitorsXml(text) {
            const path = GLib.build_filenamev(
                [GLib.get_user_config_dir(), "monitors.xml"]);
            const backup = path + ".desktop-profiles-backup";
            try {
                if (GLib.file_test(path, GLib.FileTest.EXISTS))
                    GLib.file_set_contents(backup, GLib.file_get_contents(path)[1]);
                GLib.file_set_contents(path, text);
                return true;
            } catch (e) {
                console.error("desktop-profiles: monitors.xml write failed: " + e);
                return false;
            }
        }
    };
}

const ProfileNameDialog = GObject.registerClass(
class ProfileNameDialog extends St.BoxLayout {
    /* A tiny inline save bar rather than a modal: the entry is added
     * straight into the open menu, so saving is one flow with no grab
     * juggling. Enter saves, Escape reverts focus. */
    _init(callback) {
        super._init({ vertical: false, style_class: "desktop-profiles-save-box" });
        this._callback = callback;
        this._entry = new St.Entry({
            can_focus: true,
            hint_text: "Profile name",
            x_expand: true,
            style_class: "desktop-profiles-save-entry"
        });
        this._entry.clutter_text.connect("activate", () => this._confirm());
        this._entry.clutter_text.connect("key-focus-out", () => this._confirm());
        this.add_child(this._entry);
        const button = new St.Button({
            label: "Save",
            can_focus: true,
            style_class: "button"
        });
        button.connect("clicked", () => this._confirm());
        this.add_child(button);
        this._confirmed = false;
    }

    focus() {
        this._entry.grab_key_focus();
    }

    _confirm() {
        if (this._confirmed)
            return;
        this._confirmed = true;
        const name = (this._entry.get_text() || "").trim();
        if (name && typeof this._callback === "function")
            this._callback(name);
    }
});

const DesktopProfilesButton = GObject.registerClass(
class DesktopProfilesButton extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, extension.gettext("Desktop Profiles"));

        this._extension = extension;
        this._backend = realBackend();
        this._destroyed = false;

        this.add_child(new St.Icon({
            icon_name: "document-save-symbolic",
            style_class: "system-status-icon"
        }));

        this._saveItem = new PopupMenu.PopupMenuItem(extension.gettext("Save current desktop..."));
        this._saveItem.connect("activate", () => this._promptSave());
        this.menu.addMenuItem(this._saveItem);

        this._profileSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._profileSection);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefs = new PopupMenu.PopupMenuItem(extension.gettext("Preferences"));
        prefs.connect("activate", () => extension.openPreferences());
        this.menu.addMenuItem(prefs);

        this.menu.connect("open-state-changed", (menu, open) => {
            if (open)
                this._rebuildProfiles();
        });

        this._rebuildProfiles();
    }

    _rebuildProfiles() {
        this._profileSection.removeAll();
        const names = Profiles.listProfiles(this._extension.uuid);
        if (names.length === 0) {
            const empty = new PopupMenu.PopupMenuItem(
                this._extension.gettext("No saved profiles yet"));
            empty.setSensitive(false);
            this._profileSection.addMenuItem(empty);
            return;
        }
        for (const name of names) {
            const snapshot = Profiles.loadProfile(this._extension.uuid, name);
            const info = Snapshot.describe(snapshot);
            const item = new PopupMenu.PopupMenuItem(name);
            item.label.set_text(name);
            this._profileSection.addMenuItem(item);
            const subtitle = new PopupMenu.PopupMenuItem(
                this._extension.gettext("Click to apply") + ": " +
                info.extensions + " " + this._extension.gettext("extensions") + ", " +
                info.schemas + " " + this._extension.gettext("schemas"));
            subtitle.setSensitive(false);
            subtitle.label.style = "font-size: 8pt; font-style: italic;";
            this._profileSection.addMenuItem(subtitle);
            item.connect("activate", () => this._applyProfile(name));
        }
    }

    _promptSave() {
        const box = new ProfileNameDialog((name) => {
            const snapshot = Snapshot.capture(this._backend);
            if (Profiles.saveProfile(this._extension.uuid, name, snapshot))
                Main.notify(this._extension.gettext("Desktop Profiles"),
                    this._extension.gettext("Saved profile") + " \"" + name + "\"");
            this._rebuildProfiles();
        });
        this._saveBoxItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        this._saveBoxItem.add_child(box);
        this._profileSection.addMenuItem(this._saveBoxItem);
        /* Defer focus: the menu finishes its open animation first, and
         * focusing during it drops the entry's grab. */
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            box.focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _applyProfile(name) {
        const snapshot = Profiles.loadProfile(this._extension.uuid, name);
        if (!snapshot) {
            Main.notify(this._extension.gettext("Desktop Profiles"),
                this._extension.gettext("Could not read profile") + " \"" + name + "\"");
            return;
        }
        const result = Snapshot.apply(this._backend, snapshot);
        if (result.ok) {
            Main.notify(this._extension.gettext("Desktop Profiles"),
                this._extension.gettext("Applied profile") + " \"" + name + "\". " +
                this._extension.gettext("Monitor changes land on the next login."));
        } else {
            console.error("desktop-profiles: apply failures: " + result.failures.join("; "));
            Main.notify(this._extension.gettext("Desktop Profiles"),
                this._extension.gettext("Profile applied with failures; see the logs"));
        }
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        super.destroy();
    }
});

export default class DesktopProfilesExtension extends Extension {
    enable() {
        this._button = new DesktopProfilesButton(this);
        Main.panel.addToStatusArea(this.uuid, this._button);
    }

    disable() {
        if (this._button) {
            this._button.destroy();
            this._button = null;
        }
    }
}
