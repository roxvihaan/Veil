# Veil Terminal 0.1.0

First downloadable Apple Silicon release of Veil, a minimal macOS terminal with real PTYs and interactive login shells.

## Install

Download **Veil-0.1.0-arm64.dmg**, open it, and drag **Veil Terminal** onto **Applications**. Eject the DMG before launching the installed app.

Homebrew installation is available through the project's personal tap:

```sh
brew install --cask roxvihaan/tap/veil
```

Apple Silicon (M1 or newer) only. Targets macOS 12+, tested on macOS 26.5.1. Intel is not included.

**Security note:** this build is ad-hoc signed, not Apple-notarized. macOS may block the first launch. If you trust the source, consult [Apple's per-app approval instructions](https://support.apple.com/en-us/102445). No installer or cask step disables Gatekeeper or removes quarantine. This is a personal Homebrew tap, not the main Homebrew catalog.

## Included

- Clear transparency or Liquid transparency with native behind-window blur.
- Live `veil bg color`, `veil text`, opacity controls, typography presets and defaults (including the `deafault` alias).
- Tabs and split panes that preserve their terminal buffers, scrollback and running shells.
- Login shells with Finder-safe PATH setup for installed tools such as Homebrew and Codex.
- Folder/file opening through macOS and `veil://` URLs; files open in Vim.
- True-color ASCII images, native `.icns` decoding, and GIF animation in the invoking pane.
- Optional persistent custom Neofetch image wrapper (separate installation; see README).
- Low-latency PTY batching, full-height terminal fitting and regression coverage for splits and fonts.

The DMG includes third-party license notices inside the app. The companion `.sha256` file can be checked with `shasum -a 256 -c Veil-0.1.0-arm64.dmg.sha256` from the download directory.

Save your work and quit Veil before replacing an older app. Your config is retained. See the [README](https://github.com/roxvihaan/Veil#readme) for the full feature and installation guide.
