import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import {
  createFriendsUpdateThrottle,
  FRIENDS_UPDATE_THROTTLE_MS,
} from "./friends-update-throttle.ts";

const START = 1_000_000;

const setup = (t: TestContext) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: START });
  const sendTimes: number[] = [];
  const broadcast = createFriendsUpdateThrottle(() => {
    sendTimes.push(Date.now() - START);
  });

  return { broadcast, sendTimes };
};

describe("createFriendsUpdateThrottle", () => {
  it("sends the first update immediately", (t) => {
    const { broadcast, sendTimes } = setup(t);

    broadcast();

    assert.deepEqual(sendTimes, [0]);
  });

  it("collapses a burst into one trailing send at the end of the window", (t) => {
    const { broadcast, sendTimes } = setup(t);

    broadcast();
    for (let i = 0; i < 50; i++) {
      t.mock.timers.tick(100);
      broadcast();
    }
    assert.deepEqual(sendTimes, [0]);

    t.mock.timers.tick(FRIENDS_UPDATE_THROTTLE_MS - 5_000 - 1);
    assert.deepEqual(sendTimes, [0]);

    t.mock.timers.tick(1);
    assert.deepEqual(sendTimes, [0, FRIENDS_UPDATE_THROTTLE_MS]);

    t.mock.timers.tick(FRIENDS_UPDATE_THROTTLE_MS * 3);
    assert.deepEqual(sendTimes, [0, FRIENDS_UPDATE_THROTTLE_MS]);
  });

  it("does not send again when no update arrives during the window", (t) => {
    const { broadcast, sendTimes } = setup(t);

    broadcast();
    t.mock.timers.tick(FRIENDS_UPDATE_THROTTLE_MS * 3);

    assert.deepEqual(sendTimes, [0]);
  });

  it("sends immediately when an update arrives after the window", (t) => {
    const { broadcast, sendTimes } = setup(t);

    broadcast();
    t.mock.timers.tick(FRIENDS_UPDATE_THROTTLE_MS + 1);
    broadcast();

    assert.deepEqual(sendTimes, [0, FRIENDS_UPDATE_THROTTLE_MS + 1]);
  });

  it("sends at most once per window under a steady stream and keeps the last update", (t) => {
    const { broadcast, sendTimes } = setup(t);

    for (let i = 0; i < 600; i++) {
      broadcast();
      t.mock.timers.tick(100);
    }
    t.mock.timers.tick(FRIENDS_UPDATE_THROTTLE_MS * 3);

    assert.deepEqual(
      sendTimes,
      Array.from({ length: 7 }, (_, i) => i * FRIENDS_UPDATE_THROTTLE_MS)
    );
  });

  it("drops the pending trailing send on cancel", (t) => {
    const { broadcast, sendTimes } = setup(t);

    broadcast();
    t.mock.timers.tick(1_000);
    broadcast();
    broadcast.cancel();
    t.mock.timers.tick(FRIENDS_UPDATE_THROTTLE_MS * 3);

    assert.deepEqual(sendTimes, [0]);
  });

  it("sends immediately again after cancel", (t) => {
    const { broadcast, sendTimes } = setup(t);

    broadcast();
    t.mock.timers.tick(1_000);
    broadcast();
    broadcast.cancel();
    broadcast();

    assert.deepEqual(sendTimes, [0, 1_000]);
  });
});
