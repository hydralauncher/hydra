/**
 * Shapes shared by the global Guide button subsystem.
 *
 * Everything in `src/main/services/guide` works on the normalised events
 * produced by the native watcher; nothing here knows about Win32.
 */

/** Backend that observed an event. */
export type GuideBackend = "xinput" | "raw-input";

/**
 * `guide-pressed` / `guide-released` are the button edges. `connected` and
 * `disconnected` are lifecycle notices used for diagnostics only — they never
 * trigger an action.
 */
export type GuideEventKind =
  | "guide-pressed"
  | "guide-released"
  | "connected"
  | "disconnected";

/** One normalised event, as emitted by the native watcher. */
export interface GuideEvent {
  kind: GuideEventKind;
  backend: string;
  deviceId: string;
  deviceName: string;
  vid: number;
  pid: number;
  /**
   * Milliseconds on the watcher's monotonic clock. Only differences between
   * two events from the same watcher run are meaningful.
   */
  timestampMs: number;
}

/** A controller currently known to the watcher, for diagnostics. */
export interface GuideDevice {
  deviceId: string;
  deviceName: string;
  backend: string;
  vid: number;
  pid: number;
  connected: boolean;
}

/** The native surface this subsystem depends on. */
export interface GuideNativeApi {
  isGuideWatcherSupported: () => boolean;
  isGuideWatcherRunning: () => boolean;
  startGuideWatcher: () => boolean;
  stopGuideWatcher: () => boolean;
  pollGuideEvents: () => GuideEvent[];
  describeGuideDevices: () => GuideDevice[];
}

/** What the user asked for with one Guide gesture. */
export type GuideAction = "single" | "double";
