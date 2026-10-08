import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
import { EpicConnectionStore, type EpicSessionBundle } from "./store.ts";
import type { EpicAuthWindowCallbacks } from "./auth-window.ts";
import type { EpicSessionRunner } from "./legendary-auth.ts";
import type {
  EpicConnection,
  EpicConnectionState,
} from "../../../types/epic-integration.types.ts";

const connection = {
  connected: true as const,
  connectionId: "AbCdEfG1",
  epicAccountId: "a".repeat(32),
  displayName: "Epic Test",
  connectedAt: "2026-10-07T12:00:00.000Z",
};
const bundle: EpicSessionBundle = {
  user: {
    account_id: connection.epicAccountId,
    access_token: "secret-access",
    refresh_token: "secret-refresh",
    refresh_expires_at: "2030-01-01T00:00:00Z",
  },
  version: { data: {} },
};
const code = "authorizationCode123456789";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epic-regression-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = randomBytes(32),
    iv = randomBytes(16);
  const f = {
    context: {
      environment: "http://localhost:3000",
      userId: "HydraA",
      generation: 1,
    } as EpicAuthContext | null,
    remote: { connected: false } as EpicConnection,
    vault: true,
    posts: 0,
    windows: 0,
    callbacks: null as EpicAuthWindowCallbacks | null,
    events: [] as EpicConnectionState[],
  };
  const store = new EpicConnectionStore({
    userDataPath: root,
    crypto: {
      isEncryptionAvailable: () => f.vault,
      encryptString: (value) => {
        const cipher = createCipheriv("aes-256-cbc", key, iv);
        return Buffer.concat([cipher.update(value), cipher.final()]);
      },
      decryptString: (value) => {
        const cipher = createDecipheriv("aes-256-cbc", key, iv);
        return Buffer.concat([cipher.update(value), cipher.final()]).toString();
      },
    },
  });
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
    isEncryptionAvailable: () => f.vault,
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
  return {
    state: f,
    root,
    store,
    runner,
    dependencies,
    core: new EpicIntegrationCore(dependencies),
  };
}

test("lost POST is reconciled once; encrypted session survives restart and Hydra A to B to A", async (t) => {
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
  assert.equal(f.store.read(owner)?.sessionState, "ready");
  const files = fs.readdirSync(path.join(f.root, "epic-connections"));
  assert.equal(
    fs
      .readFileSync(path.join(f.root, "epic-connections", files[0]), "utf8")
      .includes("secret-access"),
    false
  );
  f.state.context = { ...owner, userId: "HydraB", generation: 2 };
  f.state.remote = { connected: false };
  await f.core.authContextChanged();
  assert.equal(f.store.read(owner)?.sessionState, "ready");
  f.state.context = { ...owner, generation: 3 };
  f.state.remote = connection;
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
  assert.deepEqual(f.store.read(f.state.context!)?.connection, connection);
});

test("missing binary or vault never blocks reading and disconnecting the remote link", async (t) => {
  const f = fixture(t);
  f.store.save(f.state.context!, connection, bundle, () => true);
  f.state.remote = connection;
  f.state.vault = false;
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
  assert.deepEqual(await f.core.startAuth(), {
    ok: false,
    error: "vault-unavailable",
  });
  assert.deepEqual(await f.core.disconnect(connection.connectionId), {
    ok: true,
  });
  assert.equal(f.store.read(f.state.context!), null);
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
  assert.equal(f.store.read(f.state.context!), null);
});
