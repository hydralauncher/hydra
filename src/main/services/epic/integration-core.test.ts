import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { EpicIntegrationError } from "./auth-protocol.ts";
import {
  EpicIntegrationCore,
  type EpicAuthContext,
  type EpicIntegrationDependencies,
} from "./integration-core.ts";
import { EpicConnectionStore, type EpicStoreDatabase } from "./store.ts";
import {
  bundle,
  connection,
  deferred,
  MemoryDatabase,
} from "./store-test-helpers.ts";
import type { EpicAuthWindowCallbacks } from "./auth-window.ts";
import type { EpicSessionRunner } from "./legendary-auth.ts";
import type {
  EpicConnection,
  EpicConnectionState,
} from "../../../types/epic-integration.types.ts";

const code = "authorizationCode123456789";

test("shutdown drains pending hydration and GET without late publication", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  await f.core.initialize();
  const readStarted = deferred<void>(),
    releaseRead = deferred<void>(),
    releaseGet = deferred<unknown>();
  db.onGet = async () => {
    readStarted.resolve();
    await releaseRead.promise;
  };
  f.dependencies.get = () => releaseGet.promise;
  const query = f.core.getConnection();
  await readStarted.promise;
  const count = f.state.events.length;
  const closing = f.core.shutdown();
  assert.equal(db.closed, false);
  releaseRead.resolve();
  releaseGet.resolve(connection);
  await query;
  await closing;
  assert.equal(db.closed, true);
  assert.equal(f.state.events.length, count);
  await assert.rejects(f.core.initialize(), { code: "operation-cancelled" });
});

test("failed compensation is surfaced by cancellation and blocks the local session", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  const start = await f.core.startAuth();
  assert.ok(start.ok);
  const started = deferred<void>(),
    release = deferred<void>();
  db.onPut = async () => {
    started.resolve();
    await release.promise;
  };
  db.onDel = async () => {
    throw new Error("secret-refresh");
  };
  const auth = f.state.callbacks!.onCode(code);
  await started.promise;
  const cancel = f.core.cancelAuth(start.operationId);
  release.resolve();
  assert.deepEqual(await auth, { ok: false, error: "cleanup-failed" });
  assert.deepEqual(await cancel, { ok: false, error: "cleanup-failed" });
  await assert.rejects(f.store.read(f.state.context!), {
    code: "cleanup-failed",
  });
  assert.deepEqual(f.state.events.at(-1)?.connection, connection);
  assert.equal(f.state.events.at(-1)?.sessionState, "unavailable");
  assert.equal(JSON.stringify(f.state.events).includes("secret-"), false);
});

test("rotated bundle is committed after cleanup and commit ends cancellation synchronously", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  const rotated = {
    ...bundle,
    user: { ...bundle.user, refresh_token: "secret-rotated" },
  };
  let cleaned = false;
  f.runner.readBundle = async () => rotated;
  f.runner.cleanup = async () => {
    cleaned = true;
  };
  db.onPut = async () => {
    assert.equal(cleaned, true);
  };
  const start = await f.core.startAuth();
  assert.equal(start.ok, true);
  assert.deepEqual(await f.state.callbacks!.onCode(code), { ok: true });
  assert.deepEqual((await f.store.read(f.state.context!))?.bundle, rotated);
  if (start.ok)
    assert.deepEqual(await f.core.cancelAuth(start.operationId), {
      ok: false,
      error: "invalid-operation",
    });
  assert.equal(JSON.stringify(f.state.events).includes("secret-"), false);
});

test("cancellation during native save waits for compensation and keeps the remote link", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  const start = await f.core.startAuth();
  assert.ok(start.ok);
  const started = deferred<void>(),
    release = deferred<void>(),
    undoStarted = deferred<void>(),
    undoRelease = deferred<void>();
  db.onPut = async () => {
    started.resolve();
    await release.promise;
  };
  db.onDel = async () => {
    undoStarted.resolve();
    await undoRelease.promise;
  };
  const auth = f.state.callbacks!.onCode(code);
  await started.promise;
  let cancelled = false;
  const cancel = f.core.cancelAuth(start.operationId).then((result) => {
    cancelled = true;
    return result;
  });
  release.resolve();
  await undoStarted.promise;
  assert.equal(cancelled, false);
  undoRelease.resolve();
  assert.deepEqual(await auth, { ok: false, error: "operation-cancelled" });
  assert.deepEqual(await cancel, { ok: true });
  assert.equal(await f.store.read(f.state.context!), null);
  assert.deepEqual(f.state.remote, connection);
  assert.equal(
    f.state.events.some((state) => state.sessionState === "ready"),
    false
  );
});

test("cancellation while cleaning Legendary files prevents persistence", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db),
    started = deferred<void>(),
    release = deferred<void>();
  let writes = 0;
  db.onPut = async () => {
    writes++;
  };
  f.runner.cleanup = async () => {
    started.resolve();
    await release.promise;
  };
  const start = await f.core.startAuth();
  assert.ok(start.ok);
  const auth = f.state.callbacks!.onCode(code);
  await started.promise;
  const cancel = f.core.cancelAuth(start.operationId);
  release.resolve();
  assert.deepEqual(await auth, { ok: false, error: "operation-cancelled" });
  assert.deepEqual(await cancel, { ok: true });
  assert.equal(writes, 0);
});

test("confirmed POST survives local failure and can be reauthenticated without remote rollback", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  assert.equal((await f.core.startAuth()).ok, true);
  db.onPut = async () => {
    throw new Error("secret-refresh");
  };
  assert.deepEqual(await f.state.callbacks!.onCode(code), {
    ok: false,
    error: "persistence-failed",
  });
  assert.deepEqual(f.state.events.at(-1)?.connection, connection);
  assert.equal(f.state.events.at(-1)?.verification, "confirmed");
  assert.equal(f.state.events.at(-1)?.sessionState, "unavailable");
  assert.equal(f.state.posts, 1);
  assert.equal(JSON.stringify(f.state.events).includes("secret-"), false);
  db.onPut = async () => {};
  assert.equal((await f.core.startAuth()).ok, true);
  assert.deepEqual(await f.state.callbacks!.onCode(code), { ok: true });
});

test("confirmed DELETE with failed local cleanup is represented as disconnected", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  await f.store.save(f.state.context!, connection, bundle, () => true);
  f.state.remote = connection;
  await f.core.getConnection();
  db.onDel = async () => {
    throw new Error("secret-refresh");
  };
  assert.deepEqual(await f.core.disconnect(connection.connectionId), {
    ok: false,
    error: "cleanup-failed",
  });
  assert.deepEqual(f.state.events.at(-1)?.connection, { connected: false });
  assert.equal(f.state.events.at(-1)?.verification, "confirmed");
  assert.equal(f.state.events.at(-1)?.sessionState, "unavailable");
  assert.equal(JSON.stringify(f.state.events).includes("secret-"), false);
});

test("logout during native save compensates without publishing stale user state", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db),
    owner = f.state.context!;
  assert.equal((await f.core.startAuth()).ok, true);
  const started = deferred<void>(),
    release = deferred<void>();
  db.onPut = async () => {
    started.resolve();
    await release.promise;
  };
  const auth = f.state.callbacks!.onCode(code);
  await started.promise;
  f.state.context = null;
  const eventCount = f.state.events.length;
  const logout = f.core.authContextChanged();
  release.resolve();
  assert.deepEqual(await auth, { ok: false, error: "operation-cancelled" });
  await logout;
  assert.equal(await f.store.read(owner), null);
  assert.ok(
    f.state.events
      .slice(eventCount)
      .every((state) => state.hydraUserId === null)
  );
});

test("late hydration and GET for Hydra A cannot replace Hydra B state or delete A session", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db),
    owner = f.state.context!;
  await f.store.save(owner, connection, bundle, () => true);
  const started = deferred<void>(),
    release = deferred<void>();
  let reads = 0;
  db.onGet = async () => {
    if (++reads === 1) {
      started.resolve();
      await release.promise;
    }
  };
  f.dependencies.get = async (options) =>
    options.authContext.userId === owner.userId
      ? connection
      : { connected: false };
  const previous = f.core.getConnection();
  await started.promise;
  f.state.context = { ...owner, userId: "HydraB", generation: 2 };
  const eventCount = f.state.events.length;
  await f.core.authContextChanged();
  release.resolve();
  assert.equal((await previous).hydraUserId, "HydraB");
  assert.deepEqual((await previous).connection, { connected: false });
  assert.ok(
    f.state.events
      .slice(eventCount)
      .every((state) => state.hydraUserId === "HydraB")
  );
  assert.deepEqual((await f.store.read(owner))?.bundle, bundle);
});

test("GET started before connection cannot erase the committed session", async (t) => {
  const f = fixture(t);
  assert.equal((await f.core.startAuth()).ok, true);
  const response = deferred<unknown>();
  f.dependencies.get = () => response.promise;
  const previous = f.core.getConnection();
  assert.deepEqual(await f.state.callbacks!.onCode(code), { ok: true });
  response.resolve({ connected: false });
  assert.equal((await previous).sessionState, "ready");
  assert.deepEqual((await f.store.read(f.state.context!))?.bundle, bundle);
});

test("simultaneous calls reserve one login window and one disconnect", async (t) => {
  const f = fixture(t);
  const starts = await Promise.all([f.core.startAuth(), f.core.startAuth()]);
  assert.equal(starts.filter((result) => result.ok).length, 1);
  assert.ok(
    starts.some(
      (result) => !result.ok && result.error === "operation-in-progress"
    )
  );
  assert.equal(f.state.windows, 1);
  assert.deepEqual(await f.state.callbacks!.onCode(code), { ok: true });
  let deletes = 0;
  f.dependencies.delete = async () => {
    deletes++;
    f.state.remote = { connected: false };
  };
  const results = await Promise.all([
    f.core.disconnect(connection.connectionId),
    f.core.disconnect(connection.connectionId),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.ok(
    results.some(
      (result) => !result.ok && result.error === "operation-in-progress"
    )
  );
  assert.equal(deletes, 1);
});

test("shutdown waits for native cancellation and closes without late events or reopening", async (t) => {
  const db = new MemoryDatabase(),
    f = fixture(t, db);
  assert.equal((await f.core.startAuth()).ok, true);
  const started = deferred<void>(),
    release = deferred<void>();
  db.onPut = async () => {
    started.resolve();
    await release.promise;
  };
  const auth = f.state.callbacks!.onCode(code);
  await started.promise;
  const eventCount = f.state.events.length;
  const closing = f.core.shutdown();
  assert.equal(db.closed, false);
  release.resolve();
  assert.deepEqual(await auth, { ok: false, error: "operation-cancelled" });
  await closing;
  assert.equal(db.closed, true);
  assert.equal(f.state.events.length, eventCount);
  assert.deepEqual(await f.core.startAuth(), {
    ok: false,
    error: "operation-cancelled",
  });
  await assert.rejects(f.store.read(f.state.context!), {
    code: "persistence-failed",
  });
});

function fixture(t: TestContext, database?: EpicStoreDatabase) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epic-regression-"));
  const f = {
    context: {
      environment: "http://localhost:3000",
      userId: "HydraA",
      generation: 1,
    } as EpicAuthContext | null,
    remote: { connected: false } as EpicConnection,
    posts: 0,
    windows: 0,
    callbacks: null as EpicAuthWindowCallbacks | null,
    events: [] as EpicConnectionState[],
  };
  const store = new EpicConnectionStore({
    userDataPath: root,
    ...(database ? { createDatabase: () => database } : {}),
  });
  const stores = [store];
  const reopen = async () => {
    await stores.at(-1)!.close();
    const reopened = new EpicConnectionStore({ userDataPath: root });
    stores.push(reopened);
    dependencies.store = reopened;
    return reopened;
  };
  const runner: EpicSessionRunner = {
    authenticate: async () => bundle,
    getExchangeCode: async () => "exchangeCode123456789",
    readBundle: async () => bundle,
    cleanup: async () => {},
  };
  const dependencies: EpicIntegrationDependencies = {
    getAuthContext: () => f.context,
    isAuthContextCurrent: (context) =>
      context.userId === f.context?.userId &&
      context.generation === f.context?.generation &&
      context.environment === f.context?.environment,
    store,
    availability: () => ({ available: true }),
    checkBinary: async () => "legendary",
    createRunner: async () => runner,
    openWindow: (callbacks) => {
      f.callbacks = callbacks;
      f.windows++;
      return {
        close() {
          /* No native window in this regression. */
        },
        async cleanup() {
          /* No native window session to clear. */
        },
      };
    },
    get: async () => f.remote,
    post: async () => {
      f.posts++;
      f.remote = connection;
      return f.remote;
    },
    delete: async () => {
      f.remote = { connected: false };
    },
    emit: (state) => f.events.push(state),
  };
  const core = new EpicIntegrationCore(dependencies);
  t.after(async () => {
    await core.shutdown();
    await Promise.all(stores.map((instance) => instance.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    reopen,
    state: f,
    root,
    store,
    runner,
    dependencies,
    core,
  };
}

test("lost POST is reconciled once; session survives real restart and Hydra A to B to A", async (t) => {
  const f = fixture(t),
    owner = f.state.context!;
  f.dependencies.post = async () => {
    f.state.posts++;
    f.state.remote = connection;
    throw new Error("lost response");
  };
  assert.equal((await f.core.startAuth()).ok, true);
  assert.deepEqual(await f.state.callbacks!.onCode(code), { ok: true });
  assert.equal(f.state.posts, 1);
  assert.equal((await f.store.read(owner))?.sessionState, "ready");
  assert.equal(JSON.stringify(f.state.events).includes("secret-"), false);
  f.state.context = { ...owner, userId: "HydraB", generation: 2 };
  f.state.remote = { connected: false };
  await f.core.authContextChanged();
  assert.equal((await f.store.read(owner))?.sessionState, "ready");
  f.state.context = { ...owner, generation: 3 };
  f.state.remote = connection;
  const reopened = await f.reopen();
  assert.deepEqual((await reopened.read(owner))?.bundle, bundle);
  const restarted = new EpicIntegrationCore(f.dependencies);
  assert.equal((await restarted.getConnection()).sessionState, "ready");
});

test("preparation starts API and binary checks together; logout rejects late completion", async (t) => {
  const f = fixture(t),
    api = deferred<unknown>(),
    binary = deferred<string>();
  let apiStarted = false,
    binaryStarted = false;
  f.dependencies.get = () => {
    apiStarted = true;
    return api.promise;
  };
  f.dependencies.checkBinary = () => {
    binaryStarted = true;
    return binary.promise;
  };
  const auth = f.core.startAuth();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(apiStarted && binaryStarted);
  f.state.context = null;
  const logout = f.core.authContextChanged();
  api.resolve({ connected: false });
  binary.resolve("legendary");
  assert.deepEqual(await auth, { ok: false, error: "operation-cancelled" });
  await logout;
  assert.equal(f.state.windows, 0);
  assert.equal(f.state.posts, 0);
});

test("cancelled DELETE reconciliation cannot replace the current cache with a late GET", async (t) => {
  const f = fixture(t),
    started = deferred<void>(),
    response = deferred<unknown>();
  f.state.remote = connection;
  await f.core.getConnection();
  f.dependencies.delete = async () => {
    throw new EpicIntegrationError("stale-connection");
  };
  f.dependencies.get = () => {
    started.resolve();
    return response.promise;
  };
  const disconnect = f.core.disconnect(connection.connectionId);
  await started.promise;
  const cancellation = f.core.cancelAuth(f.state.events.at(-1)!.operation!.id);
  response.resolve({ ...connection, connectionId: "NewLink12" });
  assert.deepEqual(await disconnect, {
    ok: false,
    error: "operation-cancelled",
  });
  assert.deepEqual(await cancellation, { ok: true });
  assert.deepEqual(
    (await f.store.read(f.state.context!))?.connection,
    connection
  );
});

test("missing binary does not block remote reads/disconnect; authentication needs no vault", async (t) => {
  const f = fixture(t);
  await f.store.save(f.state.context!, connection, bundle, () => true);
  f.state.remote = connection;
  f.dependencies.availability = () => ({
    available: false,
    reason: "legendary-missing",
  });
  assert.deepEqual(await f.core.startAuth(), {
    ok: false,
    error: "legendary-missing",
  });
  assert.equal((await f.core.getConnection()).connection?.connected, true);
  f.dependencies.availability = () => ({ available: true });
  assert.equal((await f.core.startAuth()).ok, true);
  assert.deepEqual(await f.state.callbacks!.onCode(code), { ok: true });
  assert.equal((await f.store.read(f.state.context!))?.sessionState, "ready");
  assert.deepEqual(await f.core.disconnect(connection.connectionId), {
    ok: true,
  });
  assert.equal(await f.store.read(f.state.context!), null);
});

test("invalid Legendary identity is rejected before proof or persistence", async (t) => {
  const f = fixture(t);
  f.runner.authenticate = async () => ({
    ...bundle,
    user: {
      ...bundle.user,
      account_id: {
        toString: () => assert.fail("identity must not be coerced"),
      },
    },
  });
  assert.equal((await f.core.startAuth()).ok, true);
  assert.deepEqual(await f.state.callbacks!.onCode(code), {
    ok: false,
    error: "invalid-response",
  });
  assert.equal(f.state.posts, 0);
  assert.equal(await f.store.read(f.state.context!), null);
});
