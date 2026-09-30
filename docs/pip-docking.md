# PiP and ASCII pane docking

## Ownership

The existing React split tree and pane IDs stay intact. Terminal leaves implicitly have `content.type = terminal`; explicit empty leaves use `{type: 'empty'}`. A linked external window occupies `{type: 'external-pip', windowId}`. The native window remains owned by its source app; the leaf owns the link, not the video. This is intentional window snapping, not OS-window embedding.

`veil pip` emits a dedicated OSC 777 marker only inside a Veil TTY. The owning xterm's public parser handler routes this to its pane ID, converts that leaf in place and sets `parkedTerminal`. Its xterm stays mounted in a hidden host so its shell and buffer are retained. Selecting a window includes that pane ID and requests docking on the first valid native geometry sample, without waiting for a mouse drag. The controller still waits for renderer ownership acknowledgement before moving the window. `Return to terminal` restores the terminal content type and reattaches the same cached xterm. Closing the split still disposes its session normally. The context menu has no image/GIF or PiP entry.

`scripts/patch-veil-terminal-persistence.mjs` adds the content handler and context actions to the compiled renderer, reusing its split/close functions. `scripts/veil-pip-pane.js` registers visible pane bounds and renders empty/link states. The main-process controller waits for the renderer to acknowledge ownership before moving the external window. A target becoming occupied, removed, or inactive cannot receive a pending dock.

## Native bridge

`veil pip bound` (the default for `veil pip`) keeps the existing fit/resize coupling. `veil pip unbound` emits `OSC 777;veil-pip;unbound`; that mode stays on the pane and is passed with explicit window selection. The controller centers the PiP's observed native dimensions on the pane, without clamping to the pane or sending pane-resize events. Native writes use `positionOnly`, skipping `kAXSizeAttribute` entirely. User-driven PiP resizing updates the observed dimensions but does not resize the split. Drag-to-detach and session restoration are shared.

`native/veil_pip.m` is a separate Accessibility process, started only by Connect. It lists movable/resizable windows across running apps and requires explicit selection. There is no AX call in Electron's main-thread input or PTY path. Selected-window geometry and mouse state are sampled at 30 Hz; AX calls have bounded messaging timeouts. Geometry commands are coalesced to the latest requested bounds. Stopping kills the helper; there is no startup polling.

`electron/pip-docking.cjs` handles selection, drag tracking, preview, pending ownership, spring settling, resize synchronization and detaching. Pane coordinates are converted from renderer DIPs to screen points using the BrowserWindow content bounds. No focus stealing, video copying, closing source windows, or changes to playback.

The helper has a stable local designated signing requirement. This is ad-hoc development signing, not Developer ID notarization. Accessibility grants and attribution still require testing on the target Mac.

## Detection and animation tuning

All overlap thresholds live in `electron/pip-geometry.cjs`, whose same geometry code is injected into the renderer for ASCII dragging:

- `preview: .28`: highlight after 28% overlap of the smaller rectangle.
- `dock: .62`: release docks at 62% overlap, rechecked against current empty panes.
- `minWidth: 160`, `minHeight: 100`: ignore unusably small targets.
- `undock: 32`: native PiP movement required to break a link.
- `stiffness: 390`, `damping: 32`: restrained 30 Hz settling spring, with a bounded duration. macOS Reduce Motion skips it.

Native PiP mouse dragging cannot use browser pointer capture. The preview follows sampled overlap; the real PiP is animated only after release. There is deliberately no mid-drag force that could fight the source app's native window drag. Preview styling is in `scripts/veil-split-sizing.css`. Set `localStorage['veil.pip.debug']='1'` in renderer devtools for an overlap percentage on the active target; disable/remove it to return to normal.

## ASCII dragging

Dropping a file uses Electron's `webUtils.getPathForFile` in preload, then the owner-checked `terminal:image-drop` IPC. `electron/image-drop.cjs` validates a supported image file, checks the foreground process against the session's shell, and rejects pending/unknown command-line input before writing the quoted `veil image` command. No shell startup files, prompt hooks, or per-output rendering paths are changed. Complex line editing is deliberately conservative until the line is submitted/cancelled. This is a lightweight foreground/input guard, not full semantic shell integration.

`scripts/veil-media-pane.js` uses pointer capture for its drag handle and a frame-coalesced transform on the floating wrapper (never `.xterm-screen`). The terminal itself retains its existing pane ID and cache entry. Floating is rendered via a React portal inside Veil; no additional shell is created. Docking swaps the source terminal leaf and destination empty leaf atomically, keeping the original split tree shape. The brief detach/reattach uses the existing terminal cache, preserving its exact DOM buffer, PTY and alternate-screen state.

## Verification and limits

`npm run test:pip` covers geometry thresholds, occupied-target rejection, cancellation, acknowledged ownership, disappearance, real Chromium pointer dragging, empty-pane behavior, resizing and xterm/session preservation. `npm test` also checks normal typing latency and nested split sizing. The renderer test captures a preview to the system temporary directory as `veil-pip-preview.png`.

Live selection and movement were checked against an existing Dia PiP on September 30, 2026, using an isolated test window without touching user shells. Its native bounds moved to the target pane, but Dia held its size at 453 × 255. The controller now remembers a reported maximum size and centers that size instead of repeatedly requesting an oversized window; this behavior has a regression test. Discovery is app-independent and limited to processes owning on-screen windows, including system helpers. Candidates are explicitly selected and labeled with app, title and dimensions; ordinary windows may also be listed because PiP titles can be blank. Apps without writable Accessibility position/size attributes are unsupported. Native drag/resize across other apps and multiple displays remains unverified. Transient AX read failures tolerate 15 missed frames before release. No permission bypass is attempted. Source apps retain size, aspect, Spaces and stacking constraints. Nearest split ancestors resize within layout constraints. Tab switching/minimizing releases the link. Edge-created splits, multiple simultaneous external windows, and OS-level floating ASCII windows are outside this implementation.

For a manual check without launching user shells, run `node_modules/.bin/electron tests/pip-renderer.electron.cjs --live`; it uses a temporary user-data directory and mock terminals, with the real PiP helper. `VEIL_PIP_DEBUG=1` on the native helper logs discovery counts and AX error codes without window titles.
