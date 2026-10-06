/**
 * Cross-backend arbitration for the global Guide button.
 *
 * One physical press of the system button can reach Hydra through more than one
 * backend at once: a DualSense driven through Steam Input or DS4Windows appears
 * both as an XInput pad and as a Sony HID collection, and virtual pad drivers
 * mirror a physical pad onto a second device. Without arbitration a single press
 * would be reported twice and the user would get a double-Guide action from one
 * tap — the failure mode this layer exists to prevent.
 *
 * The rule is deliberately state-based rather than purely time-based. A mirrored
 * report trails the original by a few milliseconds, so it always arrives *while
 * the original press is still held*; a genuine second tap of a double press can
 * only arrive after the first press was released. A short trailing window is
 * kept as well, so a mirror that lands just after a very short tap is still
 * recognised, while a humanly impossible double tap is the only thing that could
 * fall inside it.
 *
 * State is kept **per controller**, not per backend: two pads plugged into the
 * same backend are two independent controllers, and one of them must never
 * consume the other's press or close its release.
 */

import type { GuideEvent } from "./guide-events";

/**
 * How long after another backend's press a later press can still be that same
 * physical press. A double press needs two full press-and-release cycles, which
 * cannot happen this fast, so the window is safe to treat as a mirror.
 */
export const GUIDE_MIRROR_WINDOW_MS = 60;

export interface GuideArbitrationCounters {
  /** Events forwarded to the sequence layer. */
  accepted: number;
  /** Presses (and their releases) discarded as another backend's mirror. */
  mirrored: number;
  /** Releases with no press of their own to close, dropped. */
  orphans: number;
  /** Repeat presses from a controller that is already holding the button. */
  repeats: number;
}

interface OpenPress {
  backend: string;
  pressedAtMs: number;
}

export class GuideArbitrator {
  /** Presses currently held, keyed by controller. */
  private readonly openPresses = new Map<string, OpenPress>();

  /** Controllers whose press was a mirror, so their release is too. */
  private readonly mirroredDevices = new Set<string>();

  /** The most recent accepted press, for the trailing-mirror window. */
  private lastPress: {
    deviceId: string;
    backend: string;
    pressedAtMs: number;
    releasedAtMs: number | null;
  } | null = null;

  public readonly counters: GuideArbitrationCounters = {
    accepted: 0,
    mirrored: 0,
    orphans: 0,
    repeats: 0,
  };

  /**
   * Feed one event in. Returns the event when it survives arbitration, or
   * `null` when it was discarded as a duplicate.
   *
   * Lifecycle events (`connected` / `disconnected`) always pass through: they
   * carry no button edge and are only used for diagnostics.
   */
  public accept(event: GuideEvent): GuideEvent | null {
    if (event.kind === "guide-pressed") return this.acceptPress(event);
    if (event.kind === "guide-released") return this.acceptRelease(event);
    return event;
  }

  /** Drop all state, e.g. when the user switches the feature off. */
  public reset(): void {
    this.openPresses.clear();
    this.mirroredDevices.clear();
    this.lastPress = null;
  }

  private acceptPress(event: GuideEvent): GuideEvent | null {
    const { backend, deviceId, timestampMs } = event;

    // The same controller reporting a press it is already holding is a repeated
    // report, not a second gesture.
    if (this.openPresses.has(deviceId)) {
      this.counters.repeats += 1;
      return null;
    }

    if (this.isMirror(backend, timestampMs)) {
      this.mirroredDevices.add(deviceId);
      this.counters.mirrored += 1;
      return null;
    }

    this.openPresses.set(deviceId, { backend, pressedAtMs: timestampMs });
    this.lastPress = {
      deviceId,
      backend,
      pressedAtMs: timestampMs,
      releasedAtMs: null,
    };
    this.counters.accepted += 1;

    return event;
  }

  private acceptRelease(event: GuideEvent): GuideEvent | null {
    const { backend, deviceId, timestampMs } = event;

    // The press never reached the sequence layer, so neither may its release:
    // an unpaired release would otherwise close a later, genuine press.
    if (this.mirroredDevices.delete(deviceId)) {
      this.counters.mirrored += 1;
      return null;
    }

    const press = this.openPresses.get(deviceId);

    // Either this controller is not holding the button, or the release arrived
    // on a different backend than the press did. Neither is usable.
    if (press === undefined || press.backend !== backend) {
      this.counters.orphans += 1;
      return null;
    }

    this.openPresses.delete(deviceId);

    if (this.lastPress?.deviceId === deviceId) {
      this.lastPress.releasedAtMs = timestampMs;
    }

    this.counters.accepted += 1;

    return event;
  }

  private isMirror(backend: string, timestampMs: number): boolean {
    // Another backend is holding the button right now, so this press is that
    // press seen twice.
    for (const press of this.openPresses.values()) {
      if (press.backend !== backend) return true;
    }

    // Another backend already completed a press so recently that this one is
    // its trailing report rather than a new gesture.
    const last = this.lastPress;
    if (
      last !== null &&
      last.backend !== backend &&
      last.releasedAtMs !== null
    ) {
      return timestampMs - last.pressedAtMs <= GUIDE_MIRROR_WINDOW_MS;
    }

    return false;
  }
}
