/**
 * Single / double Guide gesture detection.
 *
 * A single press must not act immediately: the whole point is that a second
 * press arriving shortly afterwards turns the gesture into a different action.
 * So the first press only *arms* the single action, and a short window is opened
 * for a possible second press:
 *
 *   single: press -> wait ~300 ms -> SINGLE (focus Hydra)
 *   double: press -> press within ~300 ms -> DOUBLE (open Big Picture)
 *
 * Pending presses are tracked per controller. Two people each tapping Guide on
 * their own pad is not a double press, and one pad's press must never consume
 * the other's pending action.
 *
 * The detector has no timers and no clock of its own: it takes timestamps and
 * returns decisions. That keeps it fully testable and lets the caller drive it
 * from the application's existing event loop.
 */

import type { GuideAction } from "./guide-events";

/** How long a second press may follow the first and still count as a double. */
export const GUIDE_DOUBLE_PRESS_WINDOW_MS = 300;

export class GuideSequenceDetector {
  /** Armed single presses, keyed by the controller that produced them. */
  private readonly pending = new Map<string, number>();

  public constructor(
    private readonly windowMs: number = GUIDE_DOUBLE_PRESS_WINDOW_MS
  ) {}

  /**
   * Feed one accepted press.
   *
   * Returns `"double"` when this press completes a double press, in which case
   * the deferred single action for that controller is cancelled. Returns `null`
   * when the press only armed the deferred single action.
   */
  public press(deviceId: string, nowMs: number): GuideAction | null {
    const armedAt = this.pending.get(deviceId);

    if (armedAt !== undefined && nowMs - armedAt <= this.windowMs) {
      this.pending.delete(deviceId);
      return "double";
    }

    // Either nothing was armed for this controller or its window had already
    // elapsed. Either way this starts a fresh gesture; a stale single is
    // resolved by the caller's timer, so replacing it cannot lose an action.
    this.pending.set(deviceId, nowMs);

    return null;
  }

  /**
   * Resolve any single actions whose window has elapsed.
   *
   * Returns `"single"` when at least one was due — the action is "bring Hydra to
   * the front", so simultaneous presses from several controllers collapse into
   * that one action — and `null` while every window is still open or nothing is
   * armed.
   */
  public resolve(nowMs: number): GuideAction | null {
    let due = false;

    for (const [deviceId, armedAt] of this.pending) {
      if (nowMs - armedAt >= this.windowMs) {
        this.pending.delete(deviceId);
        due = true;
      }
    }

    return due ? "single" : null;
  }

  /** Whether any single action is currently waiting out its window. */
  public get hasPendingPress(): boolean {
    return this.pending.size > 0;
  }

  /**
   * Milliseconds until the earliest pending single action is due, or `null`
   * when nothing is armed.
   */
  public remainingMs(nowMs: number): number | null {
    let earliest: number | null = null;

    for (const armedAt of this.pending.values()) {
      const remaining = Math.max(0, this.windowMs - (nowMs - armedAt));
      earliest = earliest === null ? remaining : Math.min(earliest, remaining);
    }

    return earliest;
  }

  public reset(): void {
    this.pending.clear();
  }
}
