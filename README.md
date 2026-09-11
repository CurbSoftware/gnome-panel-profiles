# Desktop Profiles for GNOME Shell

Save and restore named desktop layouts from a panel button. A profile
captures the enabled and disabled extensions, every extension's
settings, favorite apps, a fixed set of desktop schemas, and the
monitor layout (monitors.xml). Applying writes everything back and
stages the monitor layout, which lands on the next login.

Related to the Cinnamon Panel Profiles applet
(`cinnamon-panel-profiles-applet@curbsoftware` in the same monorepo),
but a different domain by necessity: GNOME has no movable panels, so
the profile captures the desktop shape GNOME does have, extensions and
monitors. Profiles live under
`~/.config/gnome-panel-profiles@curbsoftware/profiles/`.

## Install

```bash
gnome-extensions install --force gnome-panel-profiles@curbsoftware.zip
gnome-extensions enable gnome-panel-profiles@curbsoftware
```

To install every CurbSoftware widget for this desktop (and Cinnamon or
Plasma) in one download, use the bundle AppImage:
https://github.com/CurbSoftware/curb-desktop-widgets/releases/latest

## Development

See `DEVELOPMENT.md`. Headless tests:

```bash
gjs -m dev-tools/test-gnome-panel-profiles.js
```
