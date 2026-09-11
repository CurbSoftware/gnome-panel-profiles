/**
 * profiles.js
 *
 * Profile storage for the Desktop Profiles extension: named JSON files
 * under ~/.config/gnome-panel-profiles@curbsoftware/profiles/. All
 * paths derive from GLib.get_user_config_dir(), so tests isolate the
 * store by pointing XDG_CONFIG_HOME at a temp directory, the same
 * pattern as the Cinnamon panel-profiles storage tests.
 *
 * The domain mapping from the Cinnamon Panel Profiles applet: there,
 * profiles capture Cinnamon panels, applet placement and org.cinnamon
 * GSettings. GNOME has no movable panels, so a profile here captures
 * the equivalent desktop shape: enabled extensions, their settings,
 * favorites, and the monitor layout.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const SCHEMA_VERSION = 1;

export function profilesDir(uuid) {
    return GLib.build_filenamev([GLib.get_user_config_dir(), uuid, "profiles"]);
}

function profilePath(uuid, name) {
    return GLib.build_filenamev([profilesDir(uuid), safeName(name) + ".json"]);
}

/**
 * safeName:
 *
 * Profile names become file names. Letters, digits, spaces, dashes and
 * underscores pass through; everything else becomes an underscore, so
 * no path separators or dot-leading escapes are possible.
 */
export function safeName(name) {
    const cleaned = String(name || "").replace(/[^A-Za-z0-9 _-]/g, "_").trim();
    if (!cleaned || cleaned.startsWith("."))
        return "";
    return cleaned;
}

/**
 * listProfiles:
 *
 * Returns (array): profile names, sorted, newest mtime first on ties.
 */
export function listProfiles(uuid) {
    const names = [];
    try {
        const dir = GLib.Dir.open(profilesDir(uuid), 0);
        let name;
        while ((name = dir.read_name()) !== null) {
            if (!name.endsWith(".json"))
                continue;
            const base = name.slice(0, -".json".length);
            if (base)
                names.push(base);
        }
    } catch (e) {
        return [];
    }
    return names.sort();
}

/**
 * saveProfile:
 *
 * Returns (boolean): true when written.
 */
export function saveProfile(uuid, name, snapshot) {
    const clean = safeName(name);
    if (!clean)
        return false;
    const dir = profilesDir(uuid);
    try {
        if (!GLib.file_test(dir, GLib.FileTest.EXISTS))
            GLib.mkdir_with_parents(dir, 0o700);
        const document = {
            schema: SCHEMA_VERSION,
            name: clean,
            savedAt: new Date().toISOString(),
            snapshot: snapshot
        };
        GLib.file_set_contents(profilePath(uuid, clean),
            JSON.stringify(document, null, 2) + "\n");
        return true;
    } catch (e) {
        console.error("desktop-profiles: could not save " + clean + ": " + e);
        return false;
    }
}

/**
 * loadProfile:
 *
 * Returns (object|null): the snapshot, or null when missing or
 * unreadable.
 */
export function loadProfile(uuid, name) {
    const clean = safeName(name);
    if (!clean)
        return null;
    try {
        const [ok, contents] = GLib.file_get_contents(profilePath(uuid, clean));
        if (!ok || !contents)
            return null;
        const document = JSON.parse(new TextDecoder().decode(contents));
        if (!document || typeof document !== "object")
            return null;
        return document.snapshot || null;
    } catch (e) {
        return null;
    }
}

/**
 * deleteProfile / renameProfile:
 *
 * Rename refuses to overwrite an existing profile. Both return
 * success booleans.
 */
export function deleteProfile(uuid, name) {
    const clean = safeName(name);
    if (!clean)
        return false;
    try {
        return Gio.File.new_for_path(profilePath(uuid, clean)).delete(null);
    } catch (e) {
        return false;
    }
}

export function renameProfile(uuid, name, newName) {
    const from = safeName(name);
    const to = safeName(newName);
    if (!from || !to || from === to)
        return false;
    const target = profilePath(uuid, to);
    if (GLib.file_test(target, GLib.FileTest.EXISTS))
        return false;
    try {
        Gio.File.new_for_path(profilePath(uuid, from)).move(
            Gio.File.new_for_path(target), Gio.FileCopyFlags.NONE, null, null);
        return true;
    } catch (e) {
        return false;
    }
}
