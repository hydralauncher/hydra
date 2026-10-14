import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GUIDE_MIRROR_WINDOW_MS,
  GuideArbitrator,
} from "./guide-arbitration.js";
import type { GuideEvent, GuideEventKind } from "./guide-events.js";

const event = (
  kind: GuideEventKind,
  backend: string,
  timestampMs: number,
  deviceId = `${backend}:0`
): GuideEvent => ({
  kind,
  backend,
  deviceId,
  deviceName: deviceId,
  vid: 0,
  pid: 0,
  timestampMs,
});

const press = (backend: string, at: number, deviceId?: string) =>
  event("guide-pressed", backend, at, deviceId);

const release = (backend: string, at: number, deviceId?: string) =>
  event("guide-released", backend, at, deviceId);

describe("GuideArbitrator", () => {
  it("passes an ordinary press and release through", () => {
    const arbitrator = new GuideArbitrator();

    assert.notEqual(arbitrator.accept(press("xinput", 0)), null);
    assert.notEqual(arbitrator.accept(release("xinput", 80)), null);
    assert.equal(arbitrator.counters.accepted, 2);
  });

  it("passes device lifecycle events through without touching button state", () => {
    const arbitrator = new GuideArbitrator();

    assert.notEqual(
      arbitrator.accept(event("connected", "raw-input", 0)),
      null
    );
    assert.notEqual(
      arbitrator.accept(event("disconnected", "raw-input", 10)),
      null
    );
    assert.equal(arbitrator.counters.mirrored, 0);
  });

  it("drops a second backend reporting the same held press", () => {
    const arbitrator = new GuideArbitrator();

    assert.notEqual(arbitrator.accept(press("xinput", 0)), null);
    assert.equal(arbitrator.accept(press("raw-input", 3)), null);
    assert.equal(arbitrator.counters.mirrored, 1);
  });

  it("drops the mirrored backend's release as well", () => {
    const arbitrator = new GuideArbitrator();

    arbitrator.accept(press("xinput", 0));
    arbitrator.accept(press("raw-input", 3));

    assert.equal(arbitrator.accept(release("raw-input", 90)), null);
    assert.notEqual(arbitrator.accept(release("xinput", 92)), null);
  });

  it("ignores a release that never had a press", () => {
    const arbitrator = new GuideArbitrator();

    assert.equal(arbitrator.accept(release("xinput", 0)), null);
    assert.equal(arbitrator.counters.orphans, 1);
  });

  it("ignores a repeated press from a backend already holding the button", () => {
    const arbitrator = new GuideArbitrator();

    arbitrator.accept(press("xinput", 0));

    assert.equal(arbitrator.accept(press("xinput", 40)), null);
    assert.equal(arbitrator.counters.repeats, 1);
  });

  it("keeps a genuine double press on one backend", () => {
    const arbitrator = new GuideArbitrator();

    assert.notEqual(arbitrator.accept(press("xinput", 0)), null);
    assert.notEqual(arbitrator.accept(release("xinput", 50)), null);
    assert.notEqual(
      arbitrator.accept(press("xinput", 200)),
      null,
      "a second deliberate press must reach the sequence detector"
    );
  });

  it("accepts another backend once the first press is long over", () => {
    const arbitrator = new GuideArbitrator();

    arbitrator.accept(press("xinput", 0));
    arbitrator.accept(release("xinput", 40));

    assert.notEqual(
      arbitrator.accept(press("raw-input", 40 + GUIDE_MIRROR_WINDOW_MS + 1)),
      null
    );
  });

  it("still drops a mirror that lands just after a very short tap", () => {
    const arbitrator = new GuideArbitrator();

    // A 20 ms tap is shorter than the mirror window, so a trailing report from
    // another backend must not become a gesture of its own.
    arbitrator.accept(press("xinput", 0));
    arbitrator.accept(release("xinput", 20));

    assert.equal(arbitrator.accept(press("raw-input", 25)), null);
    assert.equal(arbitrator.counters.mirrored, 1);
  });

  it("does not let an orphan release close a later genuine press", () => {
    const arbitrator = new GuideArbitrator();

    assert.equal(arbitrator.accept(release("raw-input", 0)), null);

    arbitrator.accept(press("xinput", 500));
    assert.equal(arbitrator.accept(release("raw-input", 510)), null);
    assert.notEqual(arbitrator.accept(release("xinput", 520)), null);
  });

  it("forgets everything on reset", () => {
    const arbitrator = new GuideArbitrator();

    arbitrator.accept(press("xinput", 0));
    arbitrator.reset();

    assert.notEqual(arbitrator.accept(press("raw-input", 5)), null);
  });

  it("keeps two controllers on the same backend independent", () => {
    const arbitrator = new GuideArbitrator();

    // Two pads on one backend are two controllers: the second press must not be
    // mistaken for a repeat of the first, and their releases must not cross.
    assert.notEqual(
      arbitrator.accept(press("xinput", 0, "xinput:slot0")),
      null
    );
    assert.notEqual(
      arbitrator.accept(press("xinput", 40, "xinput:slot1")),
      null
    );
    assert.equal(arbitrator.counters.repeats, 0);

    assert.notEqual(
      arbitrator.accept(release("xinput", 200, "xinput:slot0")),
      null
    );
    assert.notEqual(
      arbitrator.accept(release("xinput", 240, "xinput:slot1")),
      null
    );
    assert.equal(arbitrator.counters.orphans, 0);
  });

  it("does not let one controller's release close another's press", () => {
    const arbitrator = new GuideArbitrator();

    arbitrator.accept(press("xinput", 0, "xinput:slot0"));

    // slot1 never pressed, so its release cannot close slot0's press.
    assert.equal(
      arbitrator.accept(release("xinput", 50, "xinput:slot1")),
      null
    );
    assert.equal(arbitrator.counters.orphans, 1);

    // And slot0 can still close its own.
    assert.notEqual(
      arbitrator.accept(release("xinput", 90, "xinput:slot0")),
      null
    );
  });

  it("still treats a different backend as a mirror of a held press", () => {
    const arbitrator = new GuideArbitrator();

    // Different backends mean different devices, which is exactly the mirrored
    // case arbitration exists for.
    arbitrator.accept(press("xinput", 0, "xinput:slot0"));
    assert.equal(arbitrator.accept(press("raw-input", 3, "hid:sony0")), null);
    assert.equal(
      arbitrator.accept(release("raw-input", 90, "hid:sony0")),
      null
    );
    assert.notEqual(
      arbitrator.accept(release("xinput", 95, "xinput:slot0")),
      null
    );
  });
});
