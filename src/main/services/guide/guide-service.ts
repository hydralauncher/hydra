/**
 * Global Guide button service.
 *
 * Owns the lifecycle of the detector and turns accepted Guide gestures into
 * Hydra actions:
 *
 *   single press -> the existing "show and focus the main window" path
 *   double press -> the existing "open Big Picture" path
 *
 * This service is only a new *source* of those two actions. It does not add a
 * second navigation system, and it does not change how Hydra handles the
 * keyboard, the mouse or the pads it already supports.
 *
 * Threading: the work is split between one thread inside the native addon (which
 * must own the Raw Input window) and timers on the main process event loop
 * (which drain the queue and time the double-press window). No additional
 * threads are created here.
 */

import { performance } from "node:perf_hooks";

import { NativeAddon } from "../native-addon";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { GuideArbitrator } from "./guide-arbitration";
import { GuideSequenceDetector } from "./guide-sequences";
import type { GuideAction, GuideEvent } from "./guide-events";

/** How often queued native events are drained. */
export const GUIDE_POLL_INTERVAL_MS = 30;

/** Extra slack so a timer never fires a hair before the window has elapsed. */
const TIMER_SLACK_MS = 5;

export interface GuideDiagnostics {
  supported: boolean;
  enabled: boolean;
  watcherRunning: boolean;
  devices: ReturnType<typeof NativeAddon.describeGuideDevices>;
  arbitration: {
    accepted: number;
    mirrored: number;
    orphans: number;
    repeats: number;
  };
  actions: { single: number; double: number };
}

export class GuideService {
  private static enabled = false;
  private static pollTimer: ReturnType<typeof setInterval> | null = null;
  private static actionTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly arbitrator = new GuideArbitrator();
  private static readonly sequences = new GuideSequenceDetector();

  private static actionCounts = { single: 0, double: 0 };

  /**
   * Difference between the watcher's monotonic clock and `performance.now()`,
   * refreshed from every event that arrives. See `nativeNow`.
   */
  private static clockOffsetMs = 0;

  /** Whether this build and platform can watch the system button. */
  public static isSupported(): boolean {
    return NativeAddon.isGuideWatcherSupported();
  }

  public static isEnabled(): boolean {
    return this.enabled;
  }

  public static isWatcherRunning(): boolean {
    return NativeAddon.isGuideWatcherRunning();
  }

  /**
   * Apply the persisted preference. Safe to call repeatedly and at any time;
   * turning the feature off fully stops the detector.
   *
   * On a platform that cannot watch the system button the request is accepted
   * but nothing is started, so a profile synced from Windows cannot make Hydra
   * try to run a subsystem that does not exist here.
   */
  public static applyEnabled(enabled: boolean): void {
    const next = enabled && this.isSupported();

    if (next === this.enabled) {
      // Still make sure the watcher matches, e.g. after a failed start.
      if (next && !this.isWatcherRunning()) this.start();
      return;
    }

    this.enabled = next;

    if (next) this.start();
    else this.stop();
  }

  public static start(): void {
    if (!this.isSupported()) return;

    if (!NativeAddon.startGuideWatcher()) {
      logger.error("Global guide button: the native watcher failed to start");
      return;
    }

    this.arbitrator.reset();
    this.sequences.reset();

    if (this.pollTimer === null) {
      this.pollTimer = setInterval(() => {
        try {
          this.drain();
        } catch (error) {
          logger.error("Global guide button: polling failed", error);
        }
      }, GUIDE_POLL_INTERVAL_MS);
    }

    logger.info("Global guide button watcher started");
  }

  public static stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.cancelActionTimer();
    this.arbitrator.reset();
    this.sequences.reset();

    NativeAddon.stopGuideWatcher();

    logger.info("Global guide button watcher stopped");
  }

  /** Diagnostics for the settings screen and for support reports. */
  public static diagnostics(): GuideDiagnostics {
    return {
      supported: this.isSupported(),
      enabled: this.enabled,
      watcherRunning: this.isWatcherRunning(),
      devices: NativeAddon.describeGuideDevices(),
      arbitration: { ...this.arbitrator.counters },
      actions: { ...this.actionCounts },
    };
  }

  /** Drain queued events and act on the ones that survive arbitration. */
  private static drain(): void {
    const events = NativeAddon.pollGuideEvents();

    for (const event of events) {
      // The edges carry the watcher's own monotonic clock, which is the only
      // clock that survives a stalled event loop. Keep our clock aligned with it
      // so gestures are timed by when the button was actually pressed.
      this.clockOffsetMs = event.timestampMs - performance.now();

      const accepted = this.arbitrator.accept(event);

      if (accepted === null) continue;

      if (accepted.kind === "guide-pressed") {
        this.handlePress(accepted);
        continue;
      }

      // Releases, arrivals and removals drive no action, but they are what makes
      // a global input hook debuggable, so they are recorded as they happen.
      logger.info("Global guide button event", {
        kind: accepted.kind,
        backend: accepted.backend,
        device: accepted.deviceName,
        deviceId: accepted.deviceId,
      });
    }

    this.resolveDueAction(this.nativeNow());
  }

  /**
   * The current time on the watcher's monotonic clock.
   *
   * `performance.now()` alone would be wrong: if the main process is blocked for
   * longer than the double-press window, two taps that really were a second
   * apart are all drained at once and would share one timestamp, turning them
   * into a double press. Offsetting by the newest event's own timestamp keeps
   * gesture timing anchored to when the button was pressed, while still giving
   * the timer a "now" it can reschedule against.
   */
  private static nativeNow(): number {
    return performance.now() + this.clockOffsetMs;
  }

  private static handlePress(event: GuideEvent): void {
    logger.info("Global guide button event", {
      kind: event.kind,
      backend: event.backend,
      device: event.deviceName,
      deviceId: event.deviceId,
    });

    const action = this.sequences.press(event.deviceId, event.timestampMs);

    if (action === "double") {
      // The double gesture cancels the single one that was waiting: the window
      // is closed by the detector and the pending timer is dropped here.
      this.cancelActionTimer();
      this.runAction("double");
      return;
    }

    this.scheduleActionTimer();
  }

  private static resolveDueAction(nowMs: number): void {
    const action = this.sequences.resolve(nowMs);

    if (action !== null) {
      this.cancelActionTimer();
      this.runAction(action);
      return;
    }

    // Not due yet (an early timer, or a press that arrived in this same batch).
    if (this.sequences.hasPendingPress) this.scheduleActionTimer();
  }

  private static scheduleActionTimer(): void {
    this.cancelActionTimer();

    const remaining = this.sequences.remainingMs(this.nativeNow());

    if (remaining === null) return;

    this.actionTimer = setTimeout(() => {
      this.actionTimer = null;
      this.resolveDueAction(this.nativeNow());
    }, remaining + TIMER_SLACK_MS);
  }

  private static cancelActionTimer(): void {
    if (this.actionTimer !== null) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
  }

  private static runAction(action: GuideAction): void {
    this.actionCounts[action] += 1;

    logger.info("Global guide button action", { action });

    if (action === "double") {
      void WindowManager.openBigPictureWindow({ raiseToForeground: true });
      return;
    }

    // The existing "activate / show / centre Hydra" path, reused as-is, but
    // asking it to lift the window above whatever the user is looking at: the
    // Guide button arrives while Hydra is in the background.
    WindowManager.openMainWindow({ raiseToForeground: true });
  }
}
