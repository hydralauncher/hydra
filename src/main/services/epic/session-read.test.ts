import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { EpicIntegrationError } from "./auth-protocol.js";
import { EpicSessionProvider } from "./session-provider.js";
import { EpicConnectionStore } from "./store.js";
import {
  MemoryDatabase,
  bundle,
  connection,
  deferred,
} from "./store-test-helpers.js";

const auth = {
  environment: "https://api.example.test",
  userId: "session-read-test",
  generation: 1,
};
const signal = () => new AbortController().signal;
const expired = {
  ...bundle,
  user: { ...bundle.user, expires_at: "2000-01-01T00:00:00Z" },
};
const rotated = {
  ...bundle,
  user: {
    ...bundle.user,
    access_token: "new-access",
    refresh_token: "new-refresh",
  },
};

async function fixture(t: TestContext, staleAccess = false) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-session-read-")
  );
  const store = new EpicConnectionStore({
    userDataPath: directory,
    createDatabase: () => new MemoryDatabase(),
  });
  await store.save(
    auth,
    connection,
    staleAccess ? expired : bundle,
    () => true
  );
  let current = true;
  const session = new EpicSessionProvider(
    store,
    directory,
    async () => {
      throw new Error("legacy Legendary runner must not execute");
    },
    (context, selected) =>
      current &&
      context.generation === auth.generation &&
      selected.connectionId === connection.connectionId &&
      selected.epicAccountId === connection.epicAccountId
  );
  t.after(async () => {
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    store,
    session,
    invalidate: () => {
      current = false;
    },
  };
}

test("read snapshots bypass a held credential lease and never expose refresh tokens", async (t) => {
  const f = await fixture(t);
  const release = deferred<void>();
  const entered = deferred<void>();
  const lease = f.session.serialize(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      f.session.accessSnapshot(auth, connection, signal()),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "read-only access waited for an unrelated credential lease"
              )
            ),
          2000
        );
      }),
    ]);
    assert.equal(result.access_token, bundle.user.access_token);
    assert.equal(result.account_id, connection.epicAccountId);
    assert.equal(Object.hasOwn(result, "refresh_token"), false);
    assert.equal(Object.hasOwn(result, "refresh_expires_at"), false);
    assert.equal(
      (await f.store.read(auth))?.bundle?.user.refresh_token,
      bundle.user.refresh_token
    );
  } finally {
    clearTimeout(timeout);
    release.resolve();
    await lease;
  }
});

test("concurrent expired access snapshots share one centrally persisted refresh", async (t) => {
  const f = await fixture(t, true);
  const entered = deferred<void>();
  const release = deferred<void>();
  let refreshes = 0;
  f.session.setRefreshOperation(async (_context, _connection, source) => {
    refreshes++;
    assert.equal(source.user.refresh_token, bundle.user.refresh_token);
    entered.resolve();
    await release.promise;
    return rotated;
  });
  const first = f.session.accessSnapshot(auth, connection, signal());
  const second = f.session.accessSnapshot(auth, connection, signal());
  await entered.promise;
  release.resolve();
  const snapshots = await Promise.all([first, second]);
  assert.equal(refreshes, 1);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.access_token, rotated.user.access_token);
    assert.equal(Object.hasOwn(snapshot, "refresh_token"), false);
  }
  assert.equal(
    (await f.store.read(auth))?.bundle?.user.refresh_token,
    rotated.user.refresh_token
  );
});

test("authentication retry forces exactly one central refresh even with an unexpired access token", async (t) => {
  const f = await fixture(t);
  let refreshes = 0;
  f.session.setRefreshOperation(async () => {
    refreshes++;
    return rotated;
  });
  const snapshot = await f.session.accessSnapshot(
    auth,
    connection,
    signal(),
    true
  );
  assert.equal(snapshot.access_token, rotated.user.access_token);
  assert.equal(refreshes, 1);
});

test("a stale account context cannot persist rotated credentials", async (t) => {
  const f = await fixture(t, true);
  const entered = deferred<void>();
  const release = deferred<void>();
  f.session.setRefreshOperation(async () => {
    entered.resolve();
    await release.promise;
    return rotated;
  });
  const operation = f.session.accessSnapshot(auth, connection, signal());
  const rejected = assert.rejects(operation, { code: "operation-cancelled" });
  await entered.promise;
  f.invalidate();
  release.resolve();
  await rejected;
  assert.equal(
    (await f.store.read(auth))?.bundle?.user.refresh_token,
    bundle.user.refresh_token
  );
});

test("canceling one refresh consumer settles promptly and does not abort another consumer", async (t) => {
  const f = await fixture(t, true);
  const entered = deferred<void>();
  const release = deferred<void>();
  let refreshedSignal: AbortSignal | undefined;
  f.session.setRefreshOperation(
    async (_context, _connection, _source, refreshSignal) => {
      refreshedSignal = refreshSignal;
      entered.resolve();
      await release.promise;
      if (refreshSignal.aborted)
        throw new EpicIntegrationError("operation-cancelled");
      return rotated;
    }
  );
  const controller = new AbortController();
  const first = f.session.accessSnapshot(auth, connection, controller.signal);
  const firstResult = first.then(
    () => "completed",
    (error: unknown) =>
      error instanceof EpicIntegrationError ? error.code : "other-error"
  );
  await entered.promise;
  const second = f.session.accessSnapshot(auth, connection, signal());
  const secondResult = second.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      firstResult,
      new Promise<string>((resolve) => {
        timeout = setTimeout(() => resolve("still waiting"), 300);
      }),
    ]);
    assert.equal(result, "operation-cancelled");
    assert.equal(refreshedSignal?.aborted, false);
  } finally {
    clearTimeout(timeout);
    release.resolve();
    await Promise.all([firstResult, secondResult]);
  }
  const remaining = await secondResult;
  assert.ok("value" in remaining);
  assert.equal(remaining.value.access_token, rotated.user.access_token);
});

test("canceling a queued refresh consumer prevents any later refresh command", async (t) => {
  const f = await fixture(t, true);
  const release = deferred<void>();
  const entered = deferred<void>();
  const lease = f.session.serialize(async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  let refreshes = 0;
  f.session.setRefreshOperation(async () => {
    refreshes++;
    return rotated;
  });
  const controller = new AbortController();
  const operation = f.session.accessSnapshot(
    auth,
    connection,
    controller.signal
  );
  const rejected = assert.rejects(operation, { code: "operation-cancelled" });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  try {
    await rejected;
    assert.equal(refreshes, 0);
  } finally {
    release.resolve();
    await lease;
  }
  await f.session.serialize(async () => {});
  assert.equal(refreshes, 0);
});

test("the last refresh consumer aborts the worker while the credential lease remains held until closure", async (t) => {
  const f = await fixture(t, true);
  const entered = deferred<void>();
  const aborted = deferred<void>();
  const closed = deferred<void>();
  let refreshes = 0;
  f.session.setRefreshOperation(
    async (_context, _connection, _source, refreshSignal) => {
      refreshes++;
      if (refreshes > 1) return rotated;
      refreshSignal.addEventListener("abort", () => aborted.resolve(), {
        once: true,
      });
      entered.resolve();
      await closed.promise;
      throw new EpicIntegrationError("operation-cancelled");
    }
  );
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = f.session.accessSnapshot(
    auth,
    connection,
    firstController.signal
  );
  const firstRejected = assert.rejects(first, { code: "operation-cancelled" });
  await entered.promise;
  const second = f.session.accessSnapshot(
    auth,
    connection,
    secondController.signal
  );
  const secondRejected = assert.rejects(second, {
    code: "operation-cancelled",
  });
  await new Promise((resolve) => setImmediate(resolve));
  firstController.abort();
  secondController.abort();
  await Promise.all([firstRejected, secondRejected, aborted.promise]);
  const next = f.session.accessSnapshot(auth, connection, signal());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    refreshes,
    1,
    "the canceled worker still owns the credential lease"
  );
  closed.resolve();
  assert.equal((await next).access_token, rotated.user.access_token);
  assert.equal(refreshes, 2);
});

test("a completed token rotation is persisted even after its last consumer cancels", async (t) => {
  const f = await fixture(t, true);
  const entered = deferred<void>();
  const closed = deferred<void>();
  f.session.setRefreshOperation(async () => {
    entered.resolve();
    await closed.promise;
    return rotated;
  });
  const controller = new AbortController();
  const operation = f.session.accessSnapshot(
    auth,
    connection,
    controller.signal
  );
  const rejected = assert.rejects(operation, { code: "operation-cancelled" });
  await entered.promise;
  controller.abort();
  await rejected;
  closed.resolve();
  await f.session.serialize(async () => {});
  assert.equal(
    (await f.store.read(auth))?.bundle?.user.refresh_token,
    rotated.user.refresh_token
  );
});

test("an aborted valid snapshot and a replaced connection never expose an access token", async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    f.session.accessSnapshot(auth, connection, controller.signal),
    { code: "operation-cancelled" }
  );
  await assert.rejects(
    f.session.accessSnapshot(
      auth,
      { ...connection, connectionId: "NewConn1" },
      signal()
    )
  );
});
