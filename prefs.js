/**
 * prefs.js
 *
 * Profile manager for the Desktop Profiles extension: list, rename,
 * delete, and export a profile as a file. Applying stays in the panel
 * menu, where the capture backend lives.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import * as Profiles from './lib/profiles.js';
import * as Snapshot from './lib/desktopSnapshot.js';

export default class DesktopProfilesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;

        const page = new Adw.PreferencesPage({
            title: "Profiles",
            icon_name: "document-save-symbolic"
        });

        const group = new Adw.PreferencesGroup({
            title: "Saved profiles",
            description: "Apply profiles from the panel menu. Applying enables extensions, writes their settings and favorites, and stages the monitor layout (which lands on the next login)."
        });
        this._list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
        this._list.add_css_class("boxed-list");
        group.add(this._list);
        page.add(group);

        const note = new Adw.PreferencesGroup({
            title: "What a profile captures",
            description: "Enabled and disabled extensions, every extension's settings, favorite apps, a fixed set of desktop schemas, and monitors.xml. Bounded on purpose; it is not a full dconf dump."
        });
        page.add(note);

        window.add(page);
        window.set_default_size(520, 480);
        this._rebuild();
    }

    _rebuild() {
        if (!this._list)
            return;
        let child = this._list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._list.remove(child);
            child = next;
        }
        for (const name of Profiles.listProfiles(this.uuid)) {
            const snapshot = Profiles.loadProfile(this.uuid, name);
            const info = Snapshot.describe(snapshot);
            this._list.append(this._profileRow(name, info));
        }
        if (Profiles.listProfiles(this.uuid).length === 0) {
            const row = new Adw.ActionRow({
                title: "No saved profiles yet",
                subtitle: "Save one from the panel menu"
            });
            this._list.append(row);
        }
    }

    _profileRow(name, info) {
        const row = new Adw.ActionRow({
            title: name,
            subtitle: info.extensions + " extensions, " + info.schemas + " schemas" +
                (info.monitors ? ", monitor layout" : "")
        });

        const rename = new Gtk.Button({
            icon_name: "document-edit-symbolic",
            valign: Gtk.Align.CENTER
        });
        rename.connect("clicked", () => this._rename(name));
        row.add_suffix(rename);

        const remove = new Gtk.Button({
            icon_name: "user-trash-symbolic",
            valign: Gtk.Align.CENTER
        });
        remove.connect("clicked", () => {
            Profiles.deleteProfile(this.uuid, name);
            this._rebuild();
        });
        row.add_suffix(remove);

        return row;
    }

    _rename(name) {
        const dialog = new Adw.MessageDialog({
            heading: "Rename profile",
            body: "New name for \"" + name + "\"",
            transient_for: this._window
        });
        const entry = new Gtk.Entry({ text: name });
        dialog.set_extra_child(entry);
        dialog.add_response("cancel", "Cancel");
        dialog.add_response("rename", "Rename");
        dialog.set_response_appearance("rename", Adw.ResponseAppearance.SUGGESTED);
        dialog.connect("response", (self, response) => {
            if (response === "rename") {
                const target = (entry.get_text() || "").trim();
                if (target && target !== name) {
                    Profiles.renameProfile(this.uuid, name, target);
                    this._rebuild();
                }
            }
            dialog.destroy();
        });
        dialog.present();
    }
}
