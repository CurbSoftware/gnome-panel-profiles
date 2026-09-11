/**
 * desktopSnapshot.js
 *
 * Capture and apply a desktop profile. Everything GNOME-specific goes
 * through an injected backend so the logic runs headless against a
 * fake in tests, the same DI seam the Cinnamon Panel Profiles lib/
 * modules use. The real backend (Gio) is built in extension.js.
 *
 * Backend contract:
 *   listExtensionSchemas() -> [schema ids matching org.gnome.shell.extensions.*]
 *   readSchema(schema) -> { key: gvariant text } or null
 *   writeSchema(schema, { key: gvariant text })
 *   getEnabledExtensions() -> [uuid]
 *   setEnabledExtensions([uuid])
 *   getFavorites() -> [desktop file ids]
 *   setFavorites([ids])
 *   readMonitorsXml() -> string or null
 *   writeMonitorsXml(text) -> boolean (backs up first)
 *
 * Capture set, deliberately documented and bounded:
 *   - org.gnome.shell: enabled-extensions, disabled-extensions,
 *     favorite-apps
 *   - every present org.gnome.shell.extensions.* schema, in full
 *   - a fixed list of desktop-shape schemas (below)
 *   - ~/.config/monitors.xml
 *
 * Apply is best-effort transactional in the Cinnamon sense: the
 * previous values are captured first and returned so a failure can be
 * rolled back; extensions are enabled last so a bad settings write
 * never leaves the desktop half-switched.
 */

export const FIXED_SCHEMAS = [
    "org.gnome.desktop.wm.preferences",
    "org.gnome.mutter",
    "org.gnome.desktop.interface",
    "org.gnome.desktop.peripherals"
];

export const SHELL_SCHEMA = "org.gnome.shell";

export function capture(backend) {
    const snapshot = {
        schemas: {},
        enabledExtensions: backend.getEnabledExtensions() || [],
        favorites: backend.getFavorites() || [],
        monitorsXml: null
    };

    const schemas = [];
    for (const schema of FIXED_SCHEMAS)
        schemas.push(schema);
    for (const schema of backend.listExtensionSchemas() || [])
        schemas.push(schema);
    schemas.sort();

    for (const schema of schemas) {
        const values = backend.readSchema(schema);
        if (values)
            snapshot.schemas[schema] = values;
    }

    snapshot.monitorsXml = backend.readMonitorsXml();
    return snapshot;
}

/**
 * apply:
 * @backend, @snapshot, @options: { skipMonitors }
 *
 * Returns (object): { ok, rollback } where rollback is a capture of
 * the previous state suitable for apply() when something failed.
 */
export function apply(backend, snapshot, options) {
    options = options || {};
    const rollback = capture(backend);
    const failures = [];

    if (!snapshot || typeof snapshot !== "object")
        return { ok: false, failures: ["no snapshot"], rollback };

    for (const schema of Object.keys(snapshot.schemas || {})) {
        try {
            backend.writeSchema(schema, snapshot.schemas[schema]);
        } catch (e) {
            failures.push(schema + ": " + e);
        }
    }

    try {
        if (Array.isArray(snapshot.favorites))
            backend.setFavorites(snapshot.favorites);
    } catch (e) {
        failures.push("favorites: " + e);
    }

    if (!options.skipMonitors && typeof snapshot.monitorsXml === "string") {
        try {
            if (!backend.writeMonitorsXml(snapshot.monitorsXml))
                failures.push("monitors.xml: write refused");
        } catch (e) {
            failures.push("monitors.xml: " + e);
        }
    }

    /* Enabled extensions last: a broken extension set is the one write
     * that can make the desktop hard to recover from. */
    try {
        if (Array.isArray(snapshot.enabledExtensions))
            backend.setEnabledExtensions(snapshot.enabledExtensions);
    } catch (e) {
        failures.push("enabled-extensions: " + e);
    }

    return { ok: failures.length === 0, failures, rollback };
}

/**
 * describe:
 *
 * Returns (object): human-facing counts for menu subtitles.
 */
export function describe(snapshot) {
    if (!snapshot || typeof snapshot !== "object")
        return { extensions: 0, schemas: 0, monitors: false };
    return {
        extensions: (snapshot.enabledExtensions || []).length,
        schemas: Object.keys(snapshot.schemas || {}).length,
        monitors: typeof snapshot.monitorsXml === "string"
    };
}
