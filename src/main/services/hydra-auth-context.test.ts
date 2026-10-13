import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HydraAuthContextTracker,
  waitForHydraAuthRefresh,
} from "./hydra-auth-context.js";

describe("Hydra auth ownership", () => {
  it("rejects A callbacks after logout and after A → B → A", () => {
    const tracker = new HydraAuthContextTracker();
    const aGeneration = tracker.invalidate();
    tracker.activate("http://localhost:3000", "A", aGeneration);
    const a = tracker.getContext()!;
    tracker.invalidate();
    assert.equal(tracker.isCurrent(a), false);
    tracker.activate("http://localhost:3000", "B", tracker.generation);
    assert.equal(tracker.isCurrent(a), false);
    tracker.invalidate();
    tracker.activate("http://localhost:3000", "A", tracker.generation);
    assert.equal(tracker.isCurrent(a), false);
  });

  it("does not reactivate a login overtaken by logout", async () => {
    const tracker = new HydraAuthContextTracker();
    const signingIn = tracker.invalidate();
    await Promise.resolve();
    tracker.invalidate();
    assert.equal(tracker.activate("local", "A", signingIn), false);
    assert.equal(tracker.getContext(), null);
  });

  it("requires both environment and owner, and keeps refresh in the same epoch", () => {
    const tracker = new HydraAuthContextTracker();
    tracker.activate("local", "A", tracker.invalidate());
    const context = tracker.getContext()!;
    assert.equal(tracker.isCurrent(context), true);
    assert.equal(tracker.isCurrent({ ...context, userId: "B" }), false);
    assert.equal(
      tracker.isCurrent({ ...context, environment: "staging" }),
      false
    );
    assert.equal(tracker.isCurrent(context), true);
  });

  it("isolates optional integration errors and supports unsubscribe", () => {
    const tracker = new HydraAuthContextTracker();
    let calls = 0;
    tracker.subscribe(() => {
      throw new Error("optional integration");
    });
    const unsubscribe = tracker.subscribe(() => {
      calls += 1;
    });
    assert.doesNotThrow(() => tracker.invalidate());
    assert.equal(calls, 1);
    unsubscribe();
    tracker.invalidate();
    assert.equal(calls, 1);
  });

  it("cancels waiting without cancelling another caller's shared refresh", async () => {
    let complete!: (value: string) => void;
    const refresh = new Promise<string>((resolve) => {
      complete = resolve;
    });
    const controller = new AbortController();
    const cancelled = waitForHydraAuthRefresh(refresh, {
      signal: controller.signal,
    });
    const otherCaller = waitForHydraAuthRefresh(refresh, {});
    controller.abort();
    await assert.rejects(cancelled, { code: "ERR_CANCELED" });
    complete("refreshed");
    assert.equal(await otherCaller, "refreshed");
  });

  it("bounds refresh waiting before a timed Epic request is dispatched", async () => {
    const refresh = new Promise<never>(() => {});
    await assert.rejects(waitForHydraAuthRefresh(refresh, { timeout: 5 }), {
      code: "ETIMEDOUT",
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      waitForHydraAuthRefresh(
        Promise.reject(new Error("late shared failure")),
        { signal: controller.signal }
      ),
      { code: "ERR_CANCELED" }
    );
  });
});
