# Veil Terminal

This repository contains only Veil. Do not mix it with other utilities from the parent workspace.

- Build with `npm ci && npm run package:mac`. Generated bundles, dependency directories and native binaries stay out of Git.
- `renderer/` is the current compiled React/xterm snapshot. The editable terminal lifecycle/sizing component is in `scripts/patch-veil-terminal-persistence.mjs`; packaging applies it idempotently. Do not claim the original JSX sources are included.
- Preserve real PTYs and interactive login shells. Seed PATH for Finder launches with the bundled tools, user-local directories and both Homebrew prefixes.
- Preserve the 4 ms maximum PTY output coalescing and xterm's buffered write path. Never force private renderer repaints or promote the transparent screen with transform/will-change.
- Root panes fill the workspace. Keep padding on xterm itself, refit on geometry/font changes and resynchronize PTY dimensions after asynchronous creation. Splitting preserves the terminal instance, text, scrollback and shell.
- Default text is JetBrains Mono 14, weight 450; the separate macOS preset is SF Mono Regular 11. Accept the existing `deafault` alias.
- Liquid is clear transparency plus native background blur; Clear has no blur. Do not simulate wallpaper or reintroduce the removed trans command.
- `veil bg color <color>` changes only the window-wide tint (`glass-color`); never stack tint on splits or change opacity/text. `default` and `deafault` restore #14171c. The global `veil default` resets tint too; text-only defaults preserve it.
- ASCII/GIF rendering stays native and local. GIF playback uses only the invoking pane's alternate screen, restores it on Ctrl-C, and remains capped/batched to protect other panes' input latency.
- Neofetch uses a user-level wrapper and six-color placeholders. Do not overwrite the system Neofetch binary.
- Do not modify or re-sign other applications to force external-terminal integration.
- Run `npm test` after packaging. Do not restart a user's live Veil sessions during tests.
- Distribute versioned Apple Silicon DMGs through GitHub Releases and the `roxvihaan/tap` Homebrew cask. Keep release SHA-256 checksums pinned, preserve Gatekeeper/quarantine, and disclose ad-hoc signing until Developer ID notarization is available. Never replace an already-published release artifact in place.
- The DMG must open as a large, polished drag-to-install Finder window: prominent instructions, large actual Veil and Applications icons, a directional arrow, and no sidebar/toolbar clutter. Preserve the fixed layout and Retina background; verify the mounted installer visually before release.
