import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { UserDetails } from "@types";
import { syncSubscriptionState } from "./sync-subscription.ts";

const details = {
  id: "user-1",
  subscription: { expiresAt: "2099-01-01T00:00:00.000Z" },
} as UserDetails;

describe("subscription realtime sync", () => {
  it("broadcasts fresh subscription data", async () => {
    const broadcast = mock.fn();
    await syncSubscriptionState(new AbortController().signal, {
      fetch: async () => details,
      isLoggedIn: () => true,
      broadcast,
    });
    assert.deepEqual(broadcast.mock.calls[0]?.arguments, [details]);
  });

  it("does not apply an in-flight response after logout", async () => {
    const controller = new AbortController();
    const broadcast = mock.fn();
    let resolve!: (value: UserDetails) => void;
    const pending = syncSubscriptionState(controller.signal, {
      fetch: () => new Promise((done) => (resolve = done)),
      isLoggedIn: () => false,
      broadcast,
    });
    controller.abort();
    resolve(details);
    await pending;
    assert.equal(broadcast.mock.callCount(), 0);
  });

  it("does not broadcast stale data on network failure", async () => {
    const broadcast = mock.fn();
    await assert.rejects(
      syncSubscriptionState(new AbortController().signal, {
        fetch: async () => {
          throw new Error("offline");
        },
        isLoggedIn: () => true,
        broadcast,
      }),
      /offline/
    );
    assert.equal(broadcast.mock.callCount(), 0);
  });
});
