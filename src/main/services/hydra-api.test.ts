import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import jwt from "jsonwebtoken";
import { build } from "esbuild";
import type { Auth } from "@types";

const endpoint = "/profile/integrations/epic";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const response = (data: unknown = {}) => ({
  data,
  status: 200,
  statusText: "OK",
  headers: { "x-request-id": "test" },
});
const unauthorized = () =>
  new AxiosError("Unauthorized", undefined, undefined, undefined, {
    ...response(),
    status: 401,
  } as never);
const token = (userId: string) =>
  jwt.sign({ userId }, "test", { noTimestamp: true });
const profile = (id: string) => ({
  id,
  displayName: id,
  profileImageUrl: null,
  backgroundImageUrl: null,
  subscription: null,
});
type Request = {
  method?: string;
  url?: string;
  data: unknown;
  config: InternalAxiosRequestConfig;
};

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-api-"));
  const key = "__hydraTest" + randomUUID();
  const globals = globalThis as unknown as Record<string, unknown>;
  const values = new Map<string, unknown>();
  const requests: Request[] = [];
  const effects: string[] = [];
  const logs: unknown[][] = [];
  const respond = async (request: Request) =>
    response(
      request.url === "/profile/me"
        ? profile(
            (
              jwt.decode(
                String(request.config.headers.Authorization).slice(7)
              ) as { userId: string }
            ).userId
          )
        : {}
    );
  const hooks = {
    request: respond,
    read: async (_key: string) => undefined as void,
    write: async (_key: string, _value: unknown) => undefined as void,
    batch: async () => undefined as void,
  };
  const harness = {
    adapter: async (config: InternalAxiosRequestConfig) => {
      const request = {
        method: config.method,
        url: config.url,
        config,
        data:
          typeof config.data === "string"
            ? JSON.parse(config.data)
            : config.data,
      };
      requests.push(request);
      return { ...(await hooks.request(request)), config };
    },
    db: {
      getMany: async (keys: string[]) => keys.map((key) => values.get(key)),
      get: async (key: string) => {
        await hooks.read(key);
        if (!values.has(key)) throw new Error("Missing cache");
        return values.get(key);
      },
      put: async (key: string, value: unknown) => {
        await hooks.write(key, value);
        values.set(key, value);
      },
      batch: async (operations: Array<{ key: string }>) => {
        await hooks.batch();
        for (const operation of operations) values.delete(operation.key);
      },
    },
    WindowManager: {
      mainWindow: null,
      sendToAppWindows: (event: string) => effects.push(event),
    },
    logger: Object.fromEntries(
      ["log", "info", "error"].map((method) => [
        method,
        (...args: unknown[]) => logs.push(args),
      ])
    ),
    effects,
  };
  globals[key] = harness;
  t.after(async () => {
    delete globals[key];
    await fs.rm(root, { recursive: true, force: true });
  });
  const stubs: Record<string, string> = {
    axios:
      "import axios from 'real-axios'; export { AxiosError } from 'real-axios'; export default { create: options => axios.create({ ...options, adapter: harness.adapter }) };",
    "./window-manager": "export const WindowManager = harness.WindowManager;",
    "./library-sync": "export const uploadGamesBatch = async () => {};",
    "./library-sync/clear-games-remote-id":
      "export const clearGamesRemoteIds = async () => {};",
    "./logger": "export const networkLogger = harness.logger;",
    "../logger": "export const logger = harness.logger;",
    "@shared":
      "export class UserNotLoggedInError extends Error {} export class SubscriptionRequiredError extends Error {}",
    "@main/constants": "export const appVersion = 'test';",
    "@main/level": "export const db = harness.db;",
    "@main/level/sublevels":
      "export const levelKeys = { auth: 'auth', user: 'user' };",
    "./sse":
      "export const SSEClient = { close() { harness.effects.push('sse-close'); }, connect() {} };",
    "./achievements/achievement-watcher-manager":
      "export const AchievementWatcherManager = { resetSessionState() {} };",
    "./achievements/grouped-souvenir-worker":
      "export const groupedSouvenirWorker = { trigger() { harness.effects.push('worker-start'); }, stop() { harness.effects.push('worker-stop'); } };",
    "./linux-game-capture-session":
      "export const stopAllLinuxGameCaptureSessions = () => {};",
    "./steam-integration/steam-startup-sync":
      "export const startSteamSyncOnStartup = () => harness.effects.push('steam-start'); export const resetSteamStartupSync = () => {};",
    "./user": "export const syncDownloadSourcesFromApi = async () => {};",
  };
  const bundlePath = path.join(root, "api.mjs");
  // Exercise real auth, HTTP interceptors and profile code; replace environment boundaries only.
  await build({
    stdin: {
      contents:
        "export { HydraApi } from './hydra-api'; export { getUserData } from './user/get-user-data';",
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      loader: "ts",
    },
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define: {
      "import.meta.env.MAIN_VITE_API_URL": JSON.stringify(
        "http://localhost:3000"
      ),
    },
    plugins: [
      {
        name: "environment",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (["real-axios", "jsonwebtoken"].includes(args.path))
              return {
                path: import.meta.resolve(
                  args.path === "real-axios" ? "axios" : args.path
                ),
                external: true,
              };
            if (Object.hasOwn(stubs, args.path))
              return { path: args.path, namespace: "test" };
            return undefined;
          });
          builder.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            contents:
              "const harness = globalThis[" +
              JSON.stringify(key) +
              "]; " +
              stubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const { HydraApi: api, getUserData } = (await import(
    pathToFileURL(bundlePath).href
  )) as typeof import("./hydra-api") & typeof import("./user/get-user-data");
  await api.setupApi();
  return {
    api,
    getUserData,
    values,
    requests,
    effects,
    logs,
    hooks,
    respond,
    signIn: (userId: string) =>
      api.handleExternalAuth(
        "hydra://auth?payload=" +
          encodeURIComponent(
            Buffer.from(
              JSON.stringify({
                accessToken: token(userId),
                refreshToken: userId,
                expiresIn: 3600,
              })
            ).toString("base64")
          )
      ),
    expire: () => {
      Reflect.get(api, "userAuth").expirationTimestamp = 0;
    },
  };
}

test("late refresh or 401 from A never dispatches Epic proof or changes B", async (t) => {
  for (const status of [200, 401]) {
    const f = await fixture(t);
    await f.signIn("A");
    f.expire();
    const started = deferred<void>();
    const refresh = deferred<ReturnType<typeof response>>();
    f.hooks.request = async (request) => {
      if (request.url !== "/auth/refresh") return f.respond(request);
      assert.equal(request.config.timeout, 20_000);
      started.resolve();
      return refresh.promise;
    };
    const attempt = f.api
      .post(
        endpoint,
        { exchangeCode: "private-proof" },
        {
          authContext: f.api.getAuthContext()!,
          timeout: 20_000,
        }
      )
      .catch((error: unknown) => error);
    await started.promise;
    await f.api.handleSignOut();
    await f.signIn("B");
    if (status === 401) refresh.reject(unauthorized());
    else
      refresh.resolve(response({ accessToken: token("A"), expiresIn: 3600 }));
    assert.ok((await attempt) instanceof Error);
    assert.equal(f.api.getAuthContext()?.userId, "B");
    assert.equal((f.values.get("auth") as Auth).accessToken, token("B"));
    assert.equal(
      f.requests.some((request) => request.url === endpoint),
      false
    );
    assert.equal(JSON.stringify(f.logs).includes("private-proof"), false);
  }
});

test("logout and switching accounts serialize auth/profile writes and cleanup", async (t) => {
  for (const target of ["auth", "user"]) {
    const f = await fixture(t);
    const started = deferred<void>();
    const release = deferred<void>();
    f.hooks.write = async (key, value) => {
      const owner =
        target === "auth"
          ? (value as Auth).refreshToken
          : (value as { id: string }).id;
      if (key === target && owner === "A") {
        started.resolve();
        await release.promise;
      }
    };
    f.values.set("user", profile("A"));
    const loginA = f.signIn("A");
    await started.promise;
    const logout = f.api.handleSignOut();
    const loginB = f.signIn("B");
    release.resolve();
    await Promise.all([loginA, logout, loginB]);
    assert.equal((f.values.get("auth") as Auth).accessToken, token("B"));
    assert.notEqual(
      (f.values.get("user") as { id: string } | undefined)?.id,
      "A"
    );
    assert.equal(f.api.getAuthContext()?.userId, "B");
    await f.api.handleSignOut();
    await f.api.setupApi();
    assert.equal(f.api.isLoggedIn(), false);
    assert.equal(f.values.has("auth"), false);
    assert.equal(f.values.has("user"), false);
  }
});

test("delayed 401 cleanup finishes before B persists, without signing B out", async (t) => {
  const f = await fixture(t);
  await f.signIn("A");
  const started = deferred<void>();
  const release = deferred<void>();
  f.hooks.batch = async () => {
    started.resolve();
    await release.promise;
  };
  f.hooks.request = async (request) => {
    if (request.url === endpoint) throw unauthorized();
    return f.respond(request);
  };
  const request = f.api.get(endpoint).catch((error: unknown) => error);
  await started.promise;
  const loginB = f.signIn("B");
  release.resolve();
  assert.ok((await request) instanceof AxiosError);
  await loginB;
  assert.equal(f.api.getAuthContext()?.userId, "B");
  assert.equal((f.values.get("auth") as Auth).accessToken, token("B"));
  assert.equal(f.effects.includes("on-signout"), false);
});

test("cancel or timeout stops Epic while shared Hydra refresh remains usable", async (t) => {
  for (const cancel of [true, false]) {
    const f = await fixture(t);
    await f.signIn("A");
    f.expire();
    const started = deferred<void>();
    const refresh = deferred<ReturnType<typeof response>>();
    f.hooks.request = async (request) => {
      if (request.url !== "/auth/refresh") return f.respond(request);
      started.resolve();
      return refresh.promise;
    };
    const controller = new AbortController();
    const attempt = f.api
      .post(
        endpoint,
        { exchangeCode: "private-proof" },
        {
          authContext: f.api.getAuthContext()!,
          signal: controller.signal,
          timeout: cancel ? 20_000 : 10,
        }
      )
      .catch((error: { code: string }) => error);
    await started.promise;
    if (cancel) controller.abort();
    assert.equal(
      ((await attempt) as { code: string }).code,
      cancel ? "ERR_CANCELED" : "ETIMEDOUT"
    );
    refresh.resolve(response({ accessToken: token("A"), expiresIn: 3600 }));
    await f.api.refreshToken();
    assert.equal(f.api.isLoggedIn(), true);
    assert.equal(
      f.requests.some((request) => request.url === endpoint),
      false
    );
  }
});

test("real profile ignores late responses and cache reads after logout or account switch", async (t) => {
  for (const stage of ["response", "cache-read"]) {
    const f = await fixture(t);
    await f.signIn("A");
    f.values.set("user", profile("A"));
    const started = deferred<void>();
    const release = deferred<void>();
    if (stage === "response") {
      f.hooks.request = async (request) => {
        if (
          request.url === "/profile/me" &&
          String(request.config.headers.Authorization) ===
            "Bearer " + token("A")
        ) {
          started.resolve();
          await release.promise;
        }
        return f.respond(request);
      };
    } else
      f.hooks.read = async (key) => {
        if (key === "user" && f.api.getAuthContext()?.userId === "A") {
          started.resolve();
          await release.promise;
        }
      };
    const pending = f.getUserData();
    await started.promise;
    await f.api.handleSignOut();
    await f.signIn("B");
    release.resolve();
    assert.equal(await pending, null);
    assert.notEqual(
      (f.values.get("user") as { id: string } | undefined)?.id,
      "A"
    );
    assert.equal(f.api.hasActiveSubscription(), false);
  }
});

test("real profile preserves subscription/cache and offline fallback matches current owner", async (t) => {
  const f = await fixture(t);
  await f.signIn("A");
  const me = {
    ...profile("A"),
    subscription: {
      id: "sub",
      status: "active",
      plan: { id: "plan", name: "Hydra" },
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  };
  f.values.set("user", profile("A"));
  f.hooks.request = async () => response(me);
  assert.deepEqual(await f.getUserData(), me);
  assert.deepEqual(f.values.get("user"), me);
  assert.equal(f.api.hasActiveSubscription(), true);
  f.hooks.request = async () => {
    throw new Error("private-token");
  };
  assert.equal((await f.getUserData())?.id, "A");
  f.values.set("user", profile("B"));
  assert.equal(await f.getUserData(), null);
  f.values.delete("user");
  assert.equal(await f.getUserData(), null);
  assert.equal(JSON.stringify(f.logs).includes("private-token"), false);
  f.hooks.request = async () => response(me);
  assert.deepEqual(await f.getUserData(), me);
  assert.equal(f.values.has("user"), false);
  f.hooks.request = async () => response(profile("B"));
  assert.equal(await f.getUserData(), null);
});

test("existing HTTP contracts and optional integration failures preserve Hydra login", async (t) => {
  const f = await fixture(t);
  await f.signIn("A");
  assert.ok(f.effects.includes("steam-start"));
  f.api.onAuthContextChanged(() => {
    throw new Error("optional Epic failure");
  });
  await f.signIn("A");
  f.hooks.request = async () => response({ connected: false });
  const date = new Date("2026-10-07T15:00:00Z");
  assert.deepEqual(
    await f.api.get(
      endpoint,
      { page: 1 },
      { ifModifiedSince: date, ifNoneMatch: "etag" }
    ),
    { connected: false }
  );
  assert.equal(
    f.requests.at(-1)?.config.headers["Hydra-If-Modified-Since"],
    date.toUTCString()
  );
  assert.equal(f.requests.at(-1)?.config.headers["If-None-Match"], "etag");
  assert.deepEqual(f.requests.at(-1)?.config.params, { page: 1 });
  assert.equal((await f.api.getResponse(endpoint)).status, 200);
  assert.equal((await f.api.postResponse(endpoint)).status, 200);
  for (const method of ["post", "put", "patch"] as const)
    assert.deepEqual(await f.api[method](endpoint, { value: 1 }), {
      connected: false,
    });
  assert.deepEqual(await f.api.delete(endpoint), { connected: false });
  assert.equal(
    f.requests.at(-1)?.config.headers.Authorization,
    "Bearer " + token("A")
  );
  f.hooks.request = async () => {
    throw unauthorized();
  };
  await assert.rejects(f.api.get(endpoint, undefined, { needsAuth: false }));
  assert.equal(f.api.isLoggedIn(), true);
  await assert.rejects(f.api.get(endpoint));
  assert.equal(f.api.isLoggedIn(), false);
});
