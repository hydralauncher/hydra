import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createResponseCache,
  getRequestKey,
  type ApiGet,
} from "./response-cache.js";

const options = { params: { window: "week", take: 100 }, needsAuth: true };

describe("getRequestKey", () => {
  it("is stable regardless of param order and separates auth and account", () => {
    assert.equal(
      getRequestKey("/x", { params: { b: 2, a: 1 }, needsAuth: true }),
      getRequestKey("/x", { params: { a: 1, b: 2 }, needsAuth: true })
    );
    assert.notEqual(
      getRequestKey("/x", { params: { a: 1 }, needsAuth: true }),
      getRequestKey("/x", { params: { a: 1 }, needsAuth: false })
    );
    assert.notEqual(
      getRequestKey("/x", options, "account-a"),
      getRequestKey("/x", options, "account-b")
    );
  });
});

describe("createResponseCache", () => {
  it("caches by request, dedupes in flight requests and expires", async () => {
    let calls = 0;
    let clock = 0;
    const get: ApiGet = async () => {
      calls += 1;
      return { calls };
    };
    const cache = createResponseCache(get, () => clock, 1000);

    assert.equal(cache.peek("/a", options), undefined);
    await Promise.all([cache.get("/a", options), cache.get("/a", options)]);
    assert.equal(calls, 1);
    assert.deepEqual(cache.peek("/a", options), { calls: 1 });

    await cache.get("/b", options);
    assert.equal(calls, 2);

    clock = 1001;
    assert.equal(cache.peek("/a", options), undefined);
    await cache.get("/a", options);
    assert.equal(calls, 3);
  });

  it("does not cache failures and can be cleared", async () => {
    let calls = 0;
    const get: ApiGet = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return "ok";
    };
    const cache = createResponseCache(get);

    await assert.rejects(cache.get("/a", options));
    assert.equal(await cache.get("/a", options), "ok");

    cache.clear();
    assert.equal(cache.peek("/a", options), undefined);
    await cache.get("/a", options);
    assert.equal(calls, 3);
  });

  it("evicts a single response", async () => {
    let calls = 0;
    const cache = createResponseCache(async () => {
      calls += 1;
      return calls;
    });

    await cache.get("/a", options);
    await cache.get("/b", options);
    cache.evict("/a", options);

    assert.equal(cache.peek("/a", options), undefined);
    assert.equal(cache.peek("/b", options), 2);
    assert.equal(await cache.get("/a", options), 3);
  });

  it("keeps each account's responses apart", async () => {
    let calls = 0;
    const cache = createResponseCache(async () => {
      calls += 1;
      return calls;
    });

    await cache.get("/a", options, "account-a");
    assert.equal(cache.peek("/a", options, "account-b"), undefined);
    await cache.get("/a", options, "account-b");
    assert.equal(calls, 2);
  });

  it("ignores responses from before a clear", async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    let calls = 0;
    const get: ApiGet = () => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve("fresh");
    };
    const cache = createResponseCache(get);

    const old = cache.get("/a", options);
    cache.clear();
    assert.equal(await cache.get("/a", options), "fresh");

    resolveOld("stale");
    await old;
    assert.equal(cache.peek("/a", options), "fresh");
  });

  it("drops stale entries and keeps at most maxEntries", async () => {
    let clock = 0;
    const cache = createResponseCache(
      async (path) => path,
      () => clock,
      1000,
      2
    );

    await cache.get("/a", options);
    await cache.get("/b", options);
    await cache.get("/c", options);
    assert.equal(cache.peek("/a", options), undefined);
    assert.equal(cache.peek("/c", options), "/c");

    clock = 1001;
    assert.equal(cache.peek("/c", options), undefined);
  });
});

describe("evictPath", () => {
  it("drops every cached request for the path and keeps the others", async () => {
    const cache = createResponseCache(async (path) => ({ path }));
    const scoped = { params: { scope: "friends" }, needsAuth: true };

    await cache.get("/leaderboards/playtime", options);
    await cache.get("/leaderboards/playtime", scoped, "account");
    await cache.get("/leaderboards/playtime-extra", options);

    cache.evictPath("/leaderboards/playtime");

    assert.equal(cache.peek("/leaderboards/playtime", options), undefined);
    assert.equal(
      cache.peek("/leaderboards/playtime", scoped, "account"),
      undefined
    );
    assert.deepEqual(cache.peek("/leaderboards/playtime-extra", options), {
      path: "/leaderboards/playtime-extra",
    });
  });
});
