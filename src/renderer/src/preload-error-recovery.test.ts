import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { installPreloadErrorRecovery } from "./preload-error-recovery.js";

const createStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

const dispatchPreloadError = (eventTarget: EventTarget) => {
  const event = new Event("vite:preloadError", { cancelable: true });
  eventTarget.dispatchEvent(event);
  return event;
};

describe("installPreloadErrorRecovery", () => {
  it("reloads once and respects the retry cooldown", () => {
    const eventTarget = new EventTarget();
    let now = 1_700_000_000_000;
    let reloads = 0;
    const uninstall = installPreloadErrorRecovery({
      eventTarget,
      storage: createStorage(),
      reload: () => {
        reloads += 1;
      },
      now: () => now,
    });

    try {
      const first = dispatchPreloadError(eventTarget);
      assert.equal(first.defaultPrevented, true);
      assert.equal(reloads, 1);

      const second = dispatchPreloadError(eventTarget);
      assert.equal(second.defaultPrevented, false);
      assert.equal(reloads, 1);

      now += 60_000;
      const third = dispatchPreloadError(eventTarget);
      assert.equal(third.defaultPrevented, true);
      assert.equal(reloads, 2);
    } finally {
      uninstall();
    }
  });
});
