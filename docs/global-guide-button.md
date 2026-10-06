# Global Guide button

Press the controller's system button — **Guide** on Xbox pads, **PS / Home** on
Sony pads — while Hydra is in the background:

| Gesture                    | Action                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| one press                  | bring Hydra to the front (or focus Big Picture if it is already open) |
| two presses within ~300 ms | open Big Picture                                                      |

The button keeps reaching the game you are playing. Hydra only _observes_ it; no
input is captured, consumed, blocked or synthesised.

Off by default. Enable it in **Settings → General → Controller → Global Guide
button**. The preference is stored with the rest of `UserPreferences`, so it
survives restarts. The switch is Windows-only, because only Windows can observe
the system button without taking it away from other applications.

## Architecture

The work is split so that nothing platform-specific leaks into the application
and nothing time-based leaks into the native code.

```
native/hydra-native/src/guide/      detection (Windows)
  mod.rs                            N-API surface, one watcher thread, edge queue
  xinput.rs                         Xbox: XInputGetStateEx (ordinal 100)
  raw_hid.rs + sony.rs              Sony: RIDEV_INPUTSINK Raw Input sink
  foreground.rs                     raise a Hydra window above other apps

src/main/services/guide/            normalisation and behaviour (no Win32)
  guide-events.ts                   the normalised event shape
  guide-preferences.ts              strict reading of the persisted toggle
  guide-arbitration.ts              cross-backend duplicate suppression
  guide-sequences.ts                single / double gesture detection
  guide-service.ts                  lifecycle + wiring to WindowManager

src/main/services/window-manager.ts  where an action reaches the OS
src/renderer/.../settings-context-general.tsx   the toggle
```

### Event flow

```
XInput poll ─┐
             ├─► normalised edges ─► arbitration ─► sequence ─► WindowManager
Raw Input ───┘      (native)           (dedup)      (single/   (existing
                                                  double)     show/open paths)
```

Edges are queued by the watcher thread and drained from the main process event
loop every 30 ms. No extra JavaScript thread is created, and the double-press
window is timed with a plain `setTimeout`.

## Backends

### Xbox — `xinput`

The documented `XInputGetState` masks the Guide bit out of `wButtons`, so it can
never report the system button. Windows also exports an undocumented variant at
**ordinal 100** of `xinput1_4.dll` / `xinput1_3.dll`, whose state structure keeps
`XINPUT_GAMEPAD_GUIDE` (`0x0400`). The ordinal is resolved at runtime through
`GetProcAddress`, so the addon still loads on machines where it is missing, and
when it is missing the XInput poll is skipped entirely rather than thrown away.

XInput is polled on an ordinary thread, so this backend is inherently independent
of which window has the foreground. That is what makes Guide work while Hydra is
in the background.

### Sony — `raw-input`

Sony pads do not appear through XInput, but they publish standard HID input
reports, so a Raw Input sink registered with `RIDEV_INPUTSINK | RIDEV_DEVNOTIFY`
can read the PS/Home bit **without ever opening the device**. Opening a HID
device with `CreateFile`/`ReadFile` would take it away from the running game,
whereas a Raw Input sink only observes the stream and lets it continue to every
other consumer.

The sink is registered for the concrete game-controller usages (`0x01/0x04`,
`0x01/0x05`, `0x01/0x08`) plus the vendor-defined page (`0xFF00/0x01`).
Registering the whole HID page (`0x01/0x00`) is rejected by Windows with
`ERROR_INVALID_PARAMETER`.

The sink's window is a hidden top-level window (`WS_EX_TOOLWINDOW |
WS_EX_NOACTIVATE`, never shown) rather than a message-only window, because
message-only windows are not a reliable target for `RIDEV_INPUTSINK`.

> **Hardware validation pending.** No DualSense or DualShock 4 was available on
> the machine where this was developed, so the Sony decode path is implemented
> and unit tested against synthetic reports but has **not** been exercised with
> physical Sony hardware. See "What was actually tested" below.

### Backends deliberately not used

**GameInput** and **WinMM** were evaluated and left out:

- GameInput exposes Guide only as a _system_ button (its gamepad button enum has
  no Guide member). In measurement it was fully armed — runtime loaded, focus
  policy `0x1C0` applied before callback registration, callback `REGISTERED`, and
  the pad advertising `supportedSystemButtons = 0x00000003` — and still delivered
  **zero** Guide edges. It cannot be relied on alone.
- WinMM's only Guide-capable layout is a Sony-specific button bit, which the Raw
  Input backend already covers for the same hardware.

Adding either later means adding one backend module; the arbitration layer
already handles more than two producers.

## Producing `GUIDE_PRESSED` / `GUIDE_RELEASED`

Each backend keeps per-device edge-detection state with three flags: `primed`
(a baseline report has been seen), `pressed` (current level) and `emitted_press`
(a press was actually published).

- The **first** report for a device only establishes a baseline. A pad that is
  plugged in while the button is already held therefore does not fire an action —
  and since an Xbox pad is usually switched on _by_ holding Guide, "turn the
  controller on" stays distinguishable from "press Guide".
- A **release is only published when a press for it was published**. Together
  with `emitted_press` this makes one physical press produce exactly one
  `guide-pressed` and one `guide-released`, and makes holding the button produce
  no repeats at all, because a level that does not change produces no edge.
- On **disconnect**, an open press is closed honestly with a release before the
  `disconnected` event, so a gesture can never be left dangling.
- On XInput, a change in which slots are occupied re-primes every surviving slot.
  Windows re-assigns pads to different slots on hot-plug, and without re-priming
  that re-assignment would look like a button edge.

`connected` / `disconnected` are lifecycle notices used for diagnostics. They
never trigger an action.

## Deduplication between backends

One physical press can reach Hydra through more than one backend: a DualSense
driven through Steam Input or DS4Windows appears as an XInput pad _and_ as a Sony
HID collection, and virtual pad drivers mirror a physical pad onto a second
device. Without arbitration, one tap would be seen twice and the user would get a
double-Guide action from a single press.

`guide-arbitration.ts` resolves this **by state rather than by clock**:

- a press from backend B is dropped as a mirror when another backend is
  _currently holding_ the button, because a mirrored report trails the original
  by a few milliseconds and therefore always arrives while the original is still
  down;
- a short trailing window (`GUIDE_MIRROR_WINDOW_MS`, 60 ms) additionally catches
  a mirror that lands just after a very short tap;
- a genuine second tap of a double press can only arrive after the first press
  was released, so it is never mistaken for a mirror;
- a dropped press also drops its own release, so an unpaired release can never
  close a later, genuine press;
- a release with no open press is discarded as an orphan.

## Single / double detection

`guide-sequences.ts` deliberately holds no timers and no clock: it takes
timestamps and returns decisions, which keeps it fully testable and lets the
caller drive it from the existing event loop.

A first press only _arms_ the single action; the caller sets a timer for the rest
of the window.

```
press ─────────────────────────────► wait ~300 ms ──► SINGLE
press ──► press within ~300 ms ─────────────────────► DOUBLE
```

- On a second press inside the window the pending single is cancelled, so a
  double press **never** also runs the single action.
- Pending presses are tracked **per controller**, so two people each tapping
  Guide on their own pad is not a double press, and one pad's press cannot
  consume another's pending action.

## Raising Hydra above other applications

`show()` and `focus()` are not enough when Hydra is in the background. Windows
only lets the _foreground_ process claim the foreground, and a controller button
produces no Windows input event for Hydra at all — so the request is silently
refused and the window stays behind whatever the user is looking at. This was
observed and reproduced during development.

`WindowManager.raiseToForeground()` fixes it in two steps:

1. bouncing through `setAlwaysOnTop(true)` / `setAlwaysOnTop(false)`, which lifts
   the window in the z-order; and
2. `bringWindowToForeground()` in the native addon, which attaches the calling
   thread's input queue to the foreground thread's for the duration of
   `BringWindowToTop` + `SetForegroundWindow`. While the two queues are attached
   they share an input state, which makes the request legitimate. This is the
   same technique shells and launchers use for global shortcuts, and it
   synthesises no input.

The two existing entry points keep their old behaviour: `raiseToForeground` is
opt-in, and `openMainWindow()` / `openBigPictureWindow()` called from the UI,
from a deep link or from the tray behave exactly as before.

## Tests

| Suite                                               | Covers                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `cargo test` (`guide::sony`, `guide::raw_input`)    | Sony report layouts, VID/PID parsing, unknown-report rejection, short-report bounds     |
| `src/main/services/guide/guide-sequences.test.ts`   | single/double timing, window boundary, per-controller pairing, hold produces one action |
| `src/main/services/guide/guide-arbitration.test.ts` | mirror suppression, mirrored releases, orphan releases, genuine double press survives   |
| `src/main/services/guide/guide-preferences.test.ts` | only the boolean `true` enables the watcher                                             |

## What was actually tested

Measured on Windows 11 with an **Xbox Wireless Controller** (`VID_045E`,
`PID_0B13`, Bluetooth), Hydra built from this branch:

- the toggle appears in Settings → General → Controller and starts/stops the
  watcher (`Global guide button watcher started` / `... stopped`);
- the preference survives a restart — a fresh process started the watcher on its
  own, with no UI interaction;
- the controller is detected as `Xbox controller (slot 1)` on backend `xinput`;
- **every** physical press produced exactly one `guide-pressed` and one
  `guide-released`, and no repeats while held;
- one press → the single action fires ~310 ms later;
- two presses 125–216 ms apart → the double action fires and the single action
  does **not**;
- presses more than 300 ms apart produce separate single actions;
- Hydra comes to the front while another application holds the foreground, and
  Big Picture opens fullscreen above other applications.

### Hardware validation pending

- **Sony DualSense / DualShock 4** — not exercised. The report layouts, the
  PS/Home bit and the VID/PID table are implemented and unit tested, but no
  physical Sony controller was available. Treat the Raw Input backend as
  unproven until it has been run against real hardware.
- **Cross-backend deduplication** — the arbitration rules are unit tested, but
  only an XInput pad was present, so no real mirrored press was observed.
- **Multiple Guide-capable pads at once** — not exercised.

## Licences and provenance

Nothing here is copied from GameHQ. GameHQ is GPL-3.0 and Hydra is MIT, so
adapting its source would have made this an undistributable derivative work.
The detection approach was validated against a GameHQ-derived laboratory, and the
implementation was then written independently from permissively licensed or
factual references:

- **XInput ordinal 100 / `XINPUT_GAMEPAD_GUIDE` (0x0400)** — Microsoft's
  documented XInput ABI and the widely used undocumented ordinal.
- **Sony HID report layouts** — SDL's zlib-licensed `hidapi` drivers
  (`SDL_hidapi_ps4.c`, `SDL_hidapi_ps5.c`) and the Linux
  `hid-playstation.c` wire-format documentation. Only hardware facts (byte
  offsets, bit positions, USB ids) are used, and they are recorded in
  `native/hydra-native/src/guide/sony.rs`.
- **Windows foreground activation** — documented `SetForegroundWindow` rules and
  the standard `AttachThreadInput` technique.
