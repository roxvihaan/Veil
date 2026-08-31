# Veil Terminal 0.1.1

A proper drag-to-install DMG, with the terminal features from 0.1.0 unchanged.

## New installer

- Large 760×480 installer window instead of an ordinary Finder folder.
- Big, draggable Veil and Applications icons, with an arrow between them.
- Clear “Drag Veil to Applications” instructions and Retina-ready artwork.
- Minimal Finder chrome: no sidebar, toolbar or status-bar clutter.

Download **Veil-0.1.1-arm64.dmg**, open it, drag Veil onto Applications, then eject the disk image and open the installed app.

```sh
brew install --cask roxvihaan/tap/veil
```

Existing Homebrew users can run `brew update` followed by `brew upgrade --cask roxvihaan/tap/veil`. Save your work and quit Veil before replacing or upgrading it. Your config is preserved.

**Apple Silicon only**, targeting macOS 12+, tested on macOS 26.5.1. This release remains **ad-hoc signed, not Apple-notarized**. macOS may require [per-app approval](https://support.apple.com/en-us/102445) if you trust the source. The installer does not bypass Gatekeeper. Homebrew installation uses the project's personal tap, not the main catalog.

The companion `.sha256` file verifies the download. The previous 0.1.0 release remains available unchanged. See the [README](https://github.com/roxvihaan/Veil#readme) for all features, including GIFs, split panes, colors and transparency commands.
