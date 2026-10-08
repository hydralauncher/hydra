import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EpicIntegrationError, EPIC_OAUTH_CLIENT_ID } from "./auth-protocol.ts";
import {
  EpicIntegrationCore,
  type EpicAuthContext,
  type EpicIntegrationDependencies,
  validateEpicConnection,
} from "./integration-core.ts";
import type {
  EpicConnectedConnection,
  EpicConnectionState,
} from "../../../types/epic-integration.types.ts";
import type { EpicStoredConnection } from "./store.ts";
import { createEpicAuthRuntime } from "./auth-runtime.ts";
import { createEpicStoreCrypto } from "./crypto.ts";
import { LegendaryAuthRunner } from "./legendary-auth.ts";

const code = "testAuthorizationCode123456789";
const identity = (
  overrides: Partial<EpicConnectedConnection> = {}
): EpicConnectedConnection => ({
  connected: true,
  connectionId: "AbCdEfG1",
  epicAccountId: "a".repeat(32),
  displayName: "Epic Test",
  connectedAt: "2026-10-07T12:00:00.000Z",
  ...overrides,
});
const bundle = () => ({
  user: {
    account_id: "a".repeat(32),
    displayName: "Epic Test",
    client_id: EPIC_OAUTH_CLIENT_ID,
    access_token: "test-access",
    refresh_token: "test-refresh",
    expires_at: "2030-01-01T00:00:00.000Z",
    refresh_expires_at: "2030-02-01T00:00:00.000Z",
  },
  version: { data: { egl_config: {} } },
});

function fixture() {
  let context: EpicAuthContext | null = {
    environment: "http://localhost:3000",
    userId: "HydraA",
    generation: 1,
  };
  let remote: unknown = { connected: false };
  const records = new Map<string, EpicStoredConnection>();
  const events: EpicConnectionState[] = [];
  const calls = {
    get: 0,
    post: 0,
    delete: 0,
    auth: 0,
    exchange: 0,
    cleanup: 0,
    windows: 0,
    check: 0,
    runners: 0,
  };
  const key = (scope: { environment: string; userId: string }) =>
    `${scope.environment}:${scope.userId}`;
  let callbacks: Parameters<EpicIntegrationDependencies["openWindow"]>[0];
  const runner = {
    createRunner: async (_signal: AbortSignal) => {
      calls.runners++;
      return {
        authenticate: async () => {
          calls.auth++;
          return bundle();
        },
        getExchangeCode: async () => {
          calls.exchange++;
          return "testExchangeCode123456789";
        },
        readBundle: async () => bundle(),
        cleanup: async () => {
          calls.cleanup++;
        },
      };
    },
  };
  const deps: EpicIntegrationDependencies = {
    getAuthContext: () => context,
    isAuthContextCurrent: (captured) =>
      captured.userId === context?.userId &&
      captured.generation === context.generation &&
      captured.environment === context.environment,
    availability: () => ({ available: true }),
    isEncryptionAvailable: () => true,
    prepareAuthRunner: async () => {
      calls.check++;
      return (signal) => runner.createRunner(signal);
    },
    openWindow: (options) => {
      callbacks = options;
      calls.windows++;
      return {
        close() {
          /* Test window has no native surface. */
        },
        async cleanup() {
          /* No cookies in the fake window. */
        },
      };
    },
    store: {
      read: (scope) => records.get(key(scope)) ?? null,
      save: (scope, connection, session, isCurrent) => {
        if (!isCurrent()) throw new EpicIntegrationError("operation-cancelled");
        records.set(key(scope), {
          connection,
          sessionState: "ready",
          bundle: session,
        });
      },
      cacheConnection: (scope, connection, isCurrent) => {
        if (!isCurrent()) throw new EpicIntegrationError("operation-cancelled");
        const old = records.get(key(scope));
        records.set(
          key(scope),
          old !== undefined &&
            old.connection.connectionId === connection.connectionId &&
            old.connection.epicAccountId === connection.epicAccountId
            ? { ...old, connection }
            : { connection, sessionState: "missing" }
        );
      },
      remove: (scope) => {
        records.delete(key(scope));
      },
      invalidateSession: (scope) => {
        const old = records.get(key(scope));
        if (old)
          records.set(key(scope), {
            connection: old.connection,
            sessionState: "missing",
          });
      },
    },
    get: async (options) => {
      assert.equal(options.timeout, 20_000);
      assert.equal(options.authContext.userId, context?.userId);
      calls.get++;
      return remote;
    },
    post: async (exchangeCode, options) => {
      assert.equal(exchangeCode, "testExchangeCode123456789");
      assert.equal(options.authContext.userId, "HydraA");
      calls.post++;
      remote = identity();
      return remote;
    },
    delete: async (expected) => {
      assert.equal(expected, "AbCdEfG1");
      calls.delete++;
      remote = { connected: false };
    },
    emit: (state) => events.push(state),
  };
  const core = new EpicIntegrationCore(deps);
  return {
    core,
    deps,
    runner,
    records,
    calls,
    events,
    key,
    setContext(value: EpicAuthContext | null) {
      context = value;
    },
    setRemote(value: unknown) {
      remote = value;
    },
    getContext: () => context!,
    callbacks: () => callbacks,
  };
}

async function start(f: ReturnType<typeof fixture>) {
  const result = await f.core.startAuth();
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("start-failed");
  return result.operationId;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function preparationFixture() {
  const f = fixture();
  const api = deferred<unknown>();
  const binary = deferred<string>();
  let querySignal!: AbortSignal;
  f.deps.get = (options) => {
    f.calls.get++;
    querySignal = options.signal;
    return api.promise;
  };
  f.deps.prepareAuthRunner = async () => {
    f.calls.check++;
    await binary.promise;
    return (signal) => f.runner.createRunner(signal);
  };
  return { ...f, api, binary, querySignal: () => querySignal };
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("Linux without a protected vault can still query and disconnect, but cannot start auth", async () => {
  const f = fixture();
  const crypto = createEpicStoreCrypto("linux", {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: () => assert.fail("tokens must not use unprotected storage"),
    decryptString: () => assert.fail("unprotected storage must not be read"),
  });
  f.deps.isEncryptionAvailable = crypto.isEncryptionAvailable;
  f.setRemote(identity());
  assert.equal((await f.core.getConnection()).connection?.connected, true);
  assert.deepEqual(await f.core.startAuth(), {
    ok: false,
    error: "vault-unavailable",
  });
  assert.equal(f.calls.windows, 0);
  assert.equal(f.calls.auth, 0);
  assert.deepEqual(await f.core.disconnect("AbCdEfG1"), { ok: true });
  assert.equal(f.calls.delete, 1);
});

for (const arch of ["x64", "arm64"]) {
  test(`Linux ${arch} authenticates through Legendary and posts only its exchange code`, async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "epic-linux-legendary-")
    );
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const binary = path.join(root, "legendary");
    await fs.writeFile(binary, "embedded launcher fixture");
    const f = fixture();
    const commands: string[][] = [];
    const runtime = createEpicAuthRuntime({
      platform: "linux",
      arch,
      userDataPath: root,
      getBinaryPath: () => binary,
      createLegendaryRunner: (file, directory, signal) =>
        LegendaryAuthRunner.create(
          file,
          directory,
          signal,
          async (executable, args, options) => {
            assert.equal(executable, binary);
            assert.equal(options.shell, false);
            assert.deepEqual(args.slice(0, 2), ["--api-timeout", "15"]);
            commands.push(args);
            const config = options.env!.LEGENDARY_CONFIG_PATH!;
            if (args[2] === "auth") {
              assert.deepEqual(args.slice(2), ["auth", "--code", code]);
              await fs.writeFile(
                path.join(config, "user.json"),
                JSON.stringify(bundle().user)
              );
              await fs.writeFile(
                path.join(config, "version.json"),
                JSON.stringify(bundle().version)
              );
              return "";
            }
            assert.deepEqual(args.slice(2), ["get-token", "--json"]);
            return JSON.stringify({ code: "testExchangeCode123456789" });
          }
        ),
    });
    f.deps.availability = runtime.availability;
    f.deps.prepareAuthRunner = runtime.prepareAuthRunner;
    const operationId = await start(f);
    assert.equal(commands.length, 0, "no process before the window callback");
    assert.equal(f.calls.windows, 1);
    assert.deepEqual(await f.callbacks().onCode(code), { ok: true });
    assert.equal(commands.length, 2);
    assert.equal(f.calls.post, 1);
    assert.equal(
      f.records.get(f.key(f.getContext()))?.connection.epicAccountId,
      "a".repeat(32)
    );
    assert.equal(f.events.at(-1)?.operation, null);
    assert.doesNotMatch(
      JSON.stringify(f.events),
      /test-access|test-refresh|testExchangeCode|testAuthorizationCode/
    );
    assert.deepEqual(await fs.readdir(path.join(root, "epic-temporary")), []);
    assert.deepEqual(await f.core.cancelAuth(operationId), {
      ok: false,
      error: "invalid-operation",
    });
  });
}

for (const first of ["api", "binary"] as const) {
  test(`auth starts both checks immediately and waits for ${first === "api" ? "Legendary" : "API"}`, async () => {
    const f = preparationFixture();
    const auth = f.core.startAuth();
    await nextTurn();
    assert.equal(f.calls.get, 1);
    assert.equal(f.calls.check, 1);
    assert.equal(f.calls.runners, 0);
    assert.equal(f.calls.windows, 0);
    assert.deepEqual(await f.core.startAuth(), {
      ok: false,
      error: "operation-in-progress",
    });
    if (first === "api") f.api.resolve({ connected: false });
    else f.binary.resolve("/pinned/legendary");
    await nextTurn();
    assert.equal(f.calls.runners, 0);
    assert.equal(f.calls.windows, 0);
    if (first === "api") f.binary.resolve("/pinned/legendary");
    else f.api.resolve({ connected: false });
    assert.equal((await auth).ok, true);
    assert.equal(f.calls.runners, 1);
    assert.equal(f.calls.windows, 1);
  });
}

for (const failures of ["api", "binary", "both"] as const) {
  test(`parallel preparation handles ${failures} failure without opening auth`, async () => {
    const f = preparationFixture();
    let settled = false;
    const auth = f.core.startAuth().finally(() => {
      settled = true;
    });
    await nextTurn();
    if (failures === "api")
      f.api.reject(new EpicIntegrationError("api-unavailable"));
    else f.binary.reject(new EpicIntegrationError("legendary-unavailable"));
    await nextTurn();
    assert.equal(settled, false);
    assert.deepEqual(await f.core.startAuth(), {
      ok: false,
      error: "operation-in-progress",
    });
    if (failures === "api") f.binary.resolve("/pinned/legendary");
    else if (failures === "both")
      f.api.reject(new EpicIntegrationError("api-unavailable"));
    else f.api.resolve({ connected: false });
    assert.deepEqual(await auth, {
      ok: false,
      error:
        failures === "binary" ? "legendary-unavailable" : "api-unavailable",
    });
    assert.equal(f.calls.runners, 0);
    assert.equal(f.calls.windows, 0);
    assert.equal(f.calls.auth, 0);
    assert.equal(f.calls.post, 0);
    assert.equal(f.records.size, 0);
    assert.equal(f.events.at(-1)?.operation, null);
    assert.equal(JSON.stringify(f.events).includes("test-access"), false);
  });
}

for (const change of ["cancel", "logout", "switch"] as const) {
  test(`${change} during parallel preparation rejects late responses and writes`, async () => {
    const f = preparationFixture();
    const auth = f.core.startAuth();
    await nextTurn();
    let cancelled: Promise<unknown>;
    if (change === "cancel") {
      cancelled = f.core.shutdown();
    } else {
      f.setContext(
        change === "logout"
          ? null
          : { ...f.getContext(), userId: "HydraB", generation: 2 }
      );
      // A new owner's normal GET must not share the old response.
      f.deps.get = async () => ({ connected: false });
      cancelled = f.core.authContextChanged();
    }
    assert.equal(f.querySignal().aborted, true);
    f.api.resolve(identity());
    await nextTurn();
    assert.equal(f.calls.runners, 0);
    assert.equal(f.calls.windows, 0);
    f.binary.resolve("/pinned/legendary");
    assert.deepEqual(await auth, { ok: false, error: "operation-cancelled" });
    await cancelled;
    assert.equal(f.records.size, 0);
    assert.equal(f.calls.runners, 0);
    assert.equal(f.calls.windows, 0);
    assert.equal(f.calls.auth, 0);
    assert.equal(f.calls.post, 0);
  });
}

test("auth stores only after confirmed remote identity, no startup process, and emits no secrets", async () => {
  const f = fixture();
  assert.equal(f.calls.check, 0);
  await start(f);
  assert.equal(f.calls.auth, 0);
  assert.equal(f.calls.exchange, 0);
  assert.equal(f.calls.post, 0);
  assert.deepEqual(await f.callbacks().onCode(code), { ok: true });
  assert.equal(f.calls.auth, 1);
  assert.equal(f.calls.exchange, 1);
  assert.equal(f.calls.post, 1);
  assert.equal(f.calls.cleanup, 1);
  const state = f.events.at(-1)!;
  assert.equal(state.sessionState, "ready");
  assert.equal(state.verification, "confirmed");
  assert.equal(state.operation, null);
  assert.equal(JSON.stringify(f.events).includes("test-refresh"), false);
  assert.equal(JSON.stringify(f.events).includes("test-access"), false);
});

test("auth execution failure after window login preserves the linked session and never posts", async () => {
  const f = fixture();
  f.setRemote(identity());
  const originalBundle = bundle();
  f.records.set(f.key(f.getContext()), {
    connection: identity(),
    sessionState: "ready",
    bundle: originalBundle,
  });
  const create = f.runner.createRunner;
  f.runner.createRunner = async (...args) => ({
    ...(await create(...args)),
    authenticate: async () => {
      f.calls.auth++;
      throw new EpicIntegrationError("auth-failed");
    },
  });
  await start(f);
  assert.equal(f.calls.auth, 0);
  assert.deepEqual(await f.callbacks().onCode(code), {
    ok: false,
    error: "auth-failed",
  });
  assert.equal(f.calls.post, 0);
  assert.equal(f.calls.exchange, 0);
  assert.equal(f.calls.cleanup, 1);
  assert.equal(f.records.get(f.key(f.getContext()))!.bundle, originalBundle);
  assert.equal(f.events.at(-1)?.operation, null);
});

for (const stage of ["authenticate", "readBundle"] as const) {
  test(`invalid Legendary identity from ${stage} is rejected before POST or persistence`, async () => {
    const f = fixture();
    const invalid = {
      ...bundle(),
      user: {
        ...bundle().user,
        account_id: {
          toString() {
            assert.fail("account identity must never be coerced");
          },
        },
      },
    };
    f.deps.prepareAuthRunner = async () => async (signal) => {
      const runner = await f.runner.createRunner(signal);
      return { ...runner, [stage]: async () => invalid };
    };
    await start(f);
    assert.deepEqual(await f.callbacks().onCode(code), {
      ok: false,
      error: "invalid-response",
    });
    assert.equal(f.calls.post, 0);
    assert.equal(f.records.size, 0);
    assert.equal(f.calls.cleanup, 1);
  });
}

test("Hydra auth, unsupported platform, and vault failure prevent auth subprocess", async () => {
  for (const scenario of ["logout", "unsupported", "vault"]) {
    const f = fixture();
    if (scenario === "logout") f.setContext(null);
    if (scenario === "unsupported")
      f.deps.availability = () => ({
        available: false,
        reason: "unsupported-platform",
      });
    if (scenario === "vault") f.deps.isEncryptionAvailable = () => false;
    assert.equal((await f.core.startAuth()).ok, false);
    assert.equal(f.calls.check, 0);
    assert.equal(f.calls.windows, 0);
  }
});

test("invalid window callback ends auth and allows a fresh attempt", async () => {
  const f = fixture();
  await start(f);
  const oldCallbacks = f.callbacks();
  assert.deepEqual(await oldCallbacks.onCode("bad"), {
    ok: false,
    error: "invalid-response",
  });
  assert.equal(f.calls.auth, 0);
  assert.equal(f.calls.post, 0);
  assert.equal(f.events.at(-1)?.operation, null);
  assert.equal(f.events.at(-1)?.error, "invalid-response");
  await start(f);
  assert.deepEqual(await oldCallbacks.onCode(code), {
    ok: false,
    error: "invalid-operation",
  });
  assert.deepEqual(await f.callbacks().onCode(code), { ok: true });
});

test("duplicated window callback cannot consume another proof", async () => {
  const f = fixture();
  await start(f);
  const callbacks = f.callbacks();
  const first = callbacks.onCode(code);
  assert.deepEqual(await callbacks.onCode(code), {
    ok: false,
    error: "operation-in-progress",
  });
  await first;
  assert.equal(f.calls.post, 1);
  assert.deepEqual(await callbacks.onCode(code), {
    ok: false,
    error: "invalid-operation",
  });
});

test("same Epic reconnection preserves ID and date; another identity requires disconnect", async () => {
  const f = fixture();
  f.setRemote(identity({ epicAccountId: "b".repeat(32) }));
  await start(f);
  assert.deepEqual(await f.callbacks().onCode(code), {
    ok: false,
    error: "different-account",
  });
  assert.equal(f.calls.post, 0);
  assert.equal(
    f.records.get(f.key(f.getContext()))!.connection.epicAccountId,
    "b".repeat(32)
  );
  f.setRemote(identity());
  await start(f);
  assert.deepEqual(await f.callbacks().onCode(code), { ok: true });
  assert.equal(
    f.records.get(f.key(f.getContext()))!.connection.connectionId,
    "AbCdEfG1"
  );
  assert.equal(
    f.records.get(f.key(f.getContext()))!.connection.connectedAt,
    "2026-10-07T12:00:00.000Z"
  );
});

test("lost POST response reconciles GET without replaying exchange code", async () => {
  const f = fixture();
  f.deps.post = async () => {
    f.calls.post++;
    f.setRemote(identity());
    throw new Error("connection reset with SECRET");
  };
  await start(f);
  assert.deepEqual(await f.callbacks().onCode(code), { ok: true });
  assert.equal(f.calls.post, 1);
  assert.equal(f.calls.get, 2);
  assert.equal(f.events.at(-1)!.sessionState, "ready");
});

test("invalid proof and occupied Epic preserve existing session without storing candidate", async () => {
  for (const status of [422, 409, 503]) {
    const f = fixture();
    f.setRemote(identity());
    f.records.set(f.key(f.getContext()), {
      connection: identity(),
      sessionState: "ready",
      bundle: bundle(),
    });
    const original = f.records.get(f.key(f.getContext()))!.bundle;
    f.deps.post = async () => {
      throw { response: { status, data: "SECRET" } };
    };
    await start(f);
    assert.equal((await f.callbacks().onCode(code)).ok, false);
    assert.equal(f.records.get(f.key(f.getContext()))!.bundle, original);
    assert.equal(JSON.stringify(f.events).includes("SECRET"), false);
  }
});

test("late auth completion after logout cannot commit or emit an old owner", async () => {
  const f = fixture();
  let finishAuth!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finishAuth = resolve;
  });
  const create = f.runner.createRunner;
  f.runner.createRunner = async (...args) => {
    const runner = await create(...args);
    return {
      ...runner,
      authenticate: async () => {
        await blocked;
        return bundle();
      },
    };
  };
  await start(f);
  const attempt = f.callbacks().onCode(code);
  f.setContext(null);
  const logout = f.core.authContextChanged();
  finishAuth();
  assert.deepEqual(await attempt, { ok: false, error: "operation-cancelled" });
  await logout;
  assert.equal(f.records.size, 0);
  assert.equal(f.calls.post, 0);
  assert.equal(f.events.at(-1)!.hydraLoggedIn, false);
});

test("logout during POST prevents local commit while backend result remains authoritative next login", async () => {
  const f = fixture();
  let resolvePost!: (value: unknown) => void;
  const posted = new Promise<void>((resolve) => {
    f.deps.post = () => {
      resolve();
      return new Promise((complete) => {
        resolvePost = complete;
      });
    };
  });
  const originalContext = f.getContext();
  await start(f);
  const attempt = f.callbacks().onCode(code);
  await posted;
  f.setContext(null);
  const logout = f.core.authContextChanged();
  f.setRemote(identity());
  resolvePost(identity());
  assert.deepEqual(await attempt, { ok: false, error: "operation-cancelled" });
  await logout;
  assert.equal(f.records.size, 0);
  f.setContext({ ...originalContext, generation: 3 });
  const restored = await f.core.getConnection();
  assert.equal(restored.connection?.connected, true);
  assert.equal(restored.sessionState, "missing");
});

test("A to B to A isolates cache and preserves logout session", async () => {
  const f = fixture();
  const a = f.getContext();
  await start(f);
  await f.callbacks().onCode(code);
  f.setContext({ ...a, userId: "HydraB", generation: 2 });
  f.setRemote({ connected: false });
  await f.core.authContextChanged();
  assert.deepEqual((await f.core.getConnection()).connection, {
    connected: false,
  });
  assert.equal(f.records.get(f.key(a))!.sessionState, "ready");
  f.setContext({ ...a, generation: 3 });
  f.setRemote(identity());
  await f.core.authContextChanged();
  assert.equal((await f.core.getConnection()).sessionState, "ready");
});

test("offline query preserves encrypted session; remote change invalidates it", async () => {
  const f = fixture();
  await start(f);
  await f.callbacks().onCode(code);
  const originalGet = f.deps.get;
  f.deps.get = async () => {
    throw new Error("offline");
  };
  const offline = await f.core.getConnection();
  assert.equal(offline.verification, "unconfirmed");
  assert.equal(offline.connection?.connected, true);
  assert.equal(offline.sessionState, "ready");
  f.deps.get = originalGet;
  f.setRemote(
    identity({ connectionId: "Different1", epicAccountId: "b".repeat(32) })
  );
  const changed = await f.core.getConnection();
  assert.equal(changed.sessionState, "missing");
  assert.equal(f.records.get(f.key(f.getContext()))!.bundle, undefined);
});

test("missing binary does not block reading or deleting remote link", async () => {
  const f = fixture();
  f.deps.availability = () => ({
    available: false,
    reason: "legendary-missing",
  });
  f.setRemote(identity());
  assert.equal((await f.core.getConnection()).connection?.connected, true);
  assert.deepEqual(await f.core.disconnect("AbCdEfG1"), { ok: true });
  assert.equal(f.calls.check, 0);
  assert.equal(f.records.size, 0);
});

test("late DELETE and lost DELETE responses cannot remove a newer link", async () => {
  const f = fixture();
  f.setRemote(identity());
  await f.core.getConnection();
  f.deps.delete = async () => {
    f.setRemote(identity({ connectionId: "Different1" }));
    throw { response: { status: 409 } };
  };
  assert.deepEqual(await f.core.disconnect("AbCdEfG1"), {
    ok: false,
    error: "stale-connection",
  });
  assert.equal(
    f.records.get(f.key(f.getContext()))!.connection.connectionId,
    "Different1"
  );
  f.deps.delete = async () => {
    f.setRemote({ connected: false });
    throw new Error("response lost");
  };
  assert.deepEqual(await f.core.disconnect("Different1"), { ok: true });
  assert.equal(f.records.size, 0);
});

test("late GET before successful POST cannot overwrite confirmed link", async () => {
  const f = fixture();
  await start(f);
  let completeGet!: (value: unknown) => void;
  f.deps.get = () =>
    new Promise((resolve) => {
      completeGet = resolve;
    });
  const oldQuery = f.core.getConnection();
  await f.callbacks().onCode(code);
  completeGet({ connected: false });
  const state = await oldQuery;
  assert.equal(state.connection?.connected, true);
  assert.equal(f.records.get(f.key(f.getContext()))!.sessionState, "ready");
});

test("server success plus persistence failure keeps link and exposes safe error", async () => {
  const f = fixture();
  f.deps.store.save = () => {
    throw new EpicIntegrationError("persistence-failed");
  };
  await start(f);
  assert.deepEqual(await f.callbacks().onCode(code), {
    ok: false,
    error: "persistence-failed",
  });
  assert.equal(f.events.at(-1)!.connection?.connected, true);
  assert.equal(f.events.at(-1)!.sessionState, "missing");
});

test("API response strips extra fields and rejects invalid public contract", () => {
  assert.deepEqual(
    validateEpicConnection({ ...identity(), access_token: "SECRET" }),
    identity()
  );
  assert.throws(
    () => validateEpicConnection({ ...identity(), connectionId: 123 }),
    /invalid-response/
  );
  assert.throws(
    () => validateEpicConnection({ ...identity(), epicAccountId: "not-epic" }),
    /invalid-response/
  );
});

test("cleanup failure blocks another auth until restricted session cleanup succeeds", async () => {
  const f = fixture();
  let cleanupFails = true;
  let cleanupAttempts = 0;
  const create = f.runner.createRunner;
  f.runner.createRunner = async (...args) => ({
    ...(await create(...args)),
    cleanup: async () => {
      cleanupAttempts++;
      if (cleanupFails)
        throw new Error("SECRET in restricted temporary directory");
    },
  });
  await start(f);
  assert.deepEqual(await f.callbacks().onCode(code), {
    ok: false,
    error: "cleanup-failed",
  });
  assert.deepEqual(await f.core.startAuth(), {
    ok: false,
    error: "cleanup-failed",
  });
  assert.equal(f.calls.windows, 1);
  cleanupFails = false;
  const next = await start(f);
  assert.equal(cleanupAttempts, 3);
  await f.core.cancelAuth(next);
});

test("cancelled DELETE waits for request completion and cannot interfere with new owner", async () => {
  const f = fixture();
  f.setRemote(identity());
  await f.core.getConnection();
  let completeDelete!: () => void;
  let dispatched!: () => void;
  const started = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  f.deps.delete = async () => {
    dispatched();
    await new Promise<void>((resolve) => {
      completeDelete = resolve;
    });
  };
  const disconnect = f.core.disconnect("AbCdEfG1");
  await started;
  assert.deepEqual(await f.core.disconnect("AbCdEfG1"), {
    ok: false,
    error: "operation-in-progress",
  });
  f.setContext({ ...f.getContext(), userId: "HydraB", generation: 2 });
  f.setRemote({ connected: false });
  const switchOwner = f.core.authContextChanged();
  completeDelete();
  assert.deepEqual(await disconnect, {
    ok: false,
    error: "operation-cancelled",
  });
  await switchOwner;
  assert.equal(f.events.at(-1)!.hydraUserId, "HydraB");
  assert.equal(f.events.at(-1)!.error, undefined);
});

test("cancelling during binary preparation waits before another operation starts", async () => {
  const f = fixture();
  let finishCheck!: () => void;
  let checking!: () => void;
  const started = new Promise<void>((resolve) => {
    checking = resolve;
  });
  f.deps.prepareAuthRunner = async () => {
    checking();
    await new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    return (signal) => f.runner.createRunner(signal);
  };
  const auth = f.core.startAuth();
  await started;
  f.setContext(null);
  const logout = f.core.authContextChanged();
  finishCheck();
  assert.deepEqual(await auth, { ok: false, error: "operation-cancelled" });
  await logout;
  assert.equal(f.calls.windows, 0);
  assert.equal(f.records.size, 0);
});

test("uncertain mutation with failed reconciliation preserves link as unconfirmed", async () => {
  const f = fixture();
  f.setRemote(identity());
  await f.core.getConnection();
  f.deps.delete = async () => {
    throw new Error("unknown outcome");
  };
  f.deps.get = async () => {
    throw new Error("offline");
  };
  assert.deepEqual(await f.core.disconnect("AbCdEfG1"), {
    ok: false,
    error: "network",
  });
  assert.equal(f.events.at(-1)!.connection?.connected, true);
  assert.equal(f.events.at(-1)!.verification, "unconfirmed");
});

test("a backend link created after preflight rejects candidate and reloads authoritative identity", async () => {
  for (const [message, expectedError] of [
    ["profile/epic-disconnect-required", "different-account"],
    ["profile/epic-connection-changed", "stale-connection"],
  ] as const) {
    const f = fixture();
    f.deps.post = async () => {
      f.calls.post++;
      f.setRemote(
        identity({ connectionId: "NewLink12", epicAccountId: "b".repeat(32) })
      );
      throw {
        response: {
          status: 409,
          data: { message, sensitiveDetails: "SECRET" },
        },
      };
    };
    await start(f);
    assert.deepEqual(await f.callbacks().onCode(code), {
      ok: false,
      error: expectedError,
    });
    assert.equal(f.calls.post, 1);
    assert.equal(f.calls.get, 2);
    const stored = f.records.get(f.key(f.getContext()))!;
    assert.equal(stored.connection.epicAccountId, "b".repeat(32));
    assert.equal(stored.bundle, undefined);
    assert.equal(f.events.at(-1)!.error, expectedError);
    assert.equal(JSON.stringify(f.events).includes("SECRET"), false);
  }
});

test("occupied Epic uses account-in-use error without committing rejected candidate", async () => {
  const f = fixture();
  f.deps.post = async () => {
    f.calls.post++;
    throw {
      response: {
        status: 409,
        data: { message: "profile/epic-account-already-linked" },
      },
    };
  };
  await start(f);
  assert.deepEqual(await f.callbacks().onCode(code), {
    ok: false,
    error: "account-in-use",
  });
  assert.equal(f.calls.post, 1);
  assert.equal(f.records.size, 0);
});

test("typed late DELETE conflict reloads and preserves newer link", async () => {
  const f = fixture();
  f.setRemote(identity());
  await f.core.getConnection();
  f.deps.delete = async () => {
    f.setRemote(identity({ connectionId: "NewLink12" }));
    throw {
      response: {
        status: 409,
        data: { message: "profile/epic-connection-changed" },
      },
    };
  };
  assert.deepEqual(await f.core.disconnect("AbCdEfG1"), {
    ok: false,
    error: "stale-connection",
  });
  assert.equal(f.calls.get, 2);
  assert.equal(
    f.records.get(f.key(f.getContext()))!.connection.connectionId,
    "NewLink12"
  );
  assert.equal(f.events.at(-1)!.verification, "confirmed");
});

test("cancelling a conflicted DELETE during reconciliation cannot cache a late GET", async () => {
  const f = fixture();
  f.setRemote(identity());
  await f.core.getConnection();
  const scope = f.getContext();
  const original = f.records.get(f.key(scope));
  const started = deferred<void>();
  const response = deferred<unknown>();
  f.deps.delete = async () => {
    throw new EpicIntegrationError("stale-connection");
  };
  f.deps.get = () => {
    started.resolve();
    return response.promise;
  };
  const disconnect = f.core.disconnect("AbCdEfG1");
  await started.promise;
  const operationId = f.events.at(-1)!.operation!.id;
  const cancellation = f.core.cancelAuth(operationId);
  response.resolve(identity({ connectionId: "NewLink12" }));
  assert.deepEqual(await disconnect, {
    ok: false,
    error: "operation-cancelled",
  });
  assert.deepEqual(await cancellation, { ok: true });
  assert.deepEqual(f.records.get(f.key(scope)), original);
  assert.equal(
    f.events.some(
      (event) =>
        event.connection?.connected &&
        event.connection.connectionId === "NewLink12"
    ),
    false
  );
});

test("window errors release the operation, preserve the existing session and permit retry", async () => {
  for (const error of ["auth-failed", "invalid-response"] as const) {
    const f = fixture();
    f.setRemote(identity());
    await start(f);
    await f.callbacks().onCode(code);
    const original = f.records.get(f.key(f.getContext()));
    await start(f);
    const failedWindow = f.callbacks();
    assert.deepEqual(await failedWindow.onError(error), { ok: false, error });
    assert.equal(f.events.at(-1)?.operation, null);
    assert.equal(f.events.at(-1)?.error, error);
    assert.deepEqual(f.records.get(f.key(f.getContext())), original);
    await start(f);
    assert.deepEqual(await failedWindow.onError(error), {
      ok: false,
      error: "invalid-operation",
    });
    assert.deepEqual(await failedWindow.onCode(code), {
      ok: false,
      error: "invalid-operation",
    });
    assert.deepEqual(await f.callbacks().onCode(code), { ok: true });
    assert.equal(f.calls.post, 2);
  }
});

test("late window callbacks after logout or user switch cannot start auth or overwrite new owner", async () => {
  for (const next of [
    null,
    { environment: "http://localhost:3000", userId: "HydraB", generation: 2 },
  ]) {
    const f = fixture();
    await start(f);
    const callbacks = f.callbacks();
    f.setContext(next);
    await f.core.authContextChanged();
    const before = f.events.length;
    assert.deepEqual(await callbacks.onCode(code), {
      ok: false,
      error: "invalid-operation",
    });
    assert.deepEqual(await callbacks.onError("auth-failed"), {
      ok: false,
      error: "invalid-operation",
    });
    assert.equal(f.events.length, before);
    assert.equal(f.calls.auth, 0);
    assert.equal(f.calls.post, 0);
    assert.equal(f.records.size, 0);
  }
});

test("closing login window cancels auth and rejects any later captured code", async () => {
  const f = fixture();
  await start(f);
  const callbacks = f.callbacks();
  assert.deepEqual(await callbacks.onCancel(), { ok: true });
  assert.deepEqual(await callbacks.onCode(code), {
    ok: false,
    error: "invalid-operation",
  });
  assert.equal(f.calls.auth, 0);
  assert.equal(f.calls.post, 0);
  assert.equal(f.calls.cleanup, 1);
});
