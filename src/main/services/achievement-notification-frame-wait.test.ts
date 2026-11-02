import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { waitForAchievementNotificationFrames } from "./achievement-notification-frame-wait.js";

const FRAME_TIMEOUT = 20;
const TEST_DEADLINE = 500;

const settleWithinDeadline = <T>(promise: Promise<T>): Promise<T> => {
  let deadline: ReturnType<typeof setTimeout> | null = null;

  return Promise.race([
    promise.finally(() => {
      if (deadline) clearTimeout(deadline);
    }),
    new Promise<never>((_, reject) => {
      deadline = setTimeout(
        () => reject(new Error("frame wait did not settle")),
        TEST_DEADLINE
      );
    }),
  ]);
};

describe("waitForAchievementNotificationFrames", () => {
  it("resolves when the renderer reports frames", async () => {
    let calls = 0;

    await settleWithinDeadline(
      waitForAchievementNotificationFrames(
        {
          async executeJavaScript() {
            calls += 1;
          },
        },
        FRAME_TIMEOUT
      )
    );

    assert.equal(calls, 1);
  });

  it("resolves after the timeout when the renderer never reports a frame", async () => {
    const startedAt = Date.now();

    await settleWithinDeadline(
      waitForAchievementNotificationFrames(
        {
          executeJavaScript() {
            return new Promise(() => {});
          },
        },
        FRAME_TIMEOUT
      )
    );

    assert.ok(Date.now() - startedAt >= FRAME_TIMEOUT / 2);
  });

  it("propagates renderer errors", async () => {
    await assert.rejects(
      waitForAchievementNotificationFrames(
        {
          async executeJavaScript() {
            throw new Error("renderer failed");
          },
        },
        FRAME_TIMEOUT
      ),
      /renderer failed/
    );
  });
});
