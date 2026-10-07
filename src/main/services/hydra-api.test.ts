import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AxiosError, type AxiosResponse } from "axios";
import jwt from "jsonwebtoken";
import { build } from "esbuild";
import type { Auth } from "@types";

const require = createRequire(import.meta.url);
const endpoint = "/profile/integrations/epic";
const apiEnvironment = "http://localhost:3000";
const registryKey = "__hydraApiRegressionHarnesses";

interface RequestConfig {
  headers?: Record<string, string | undefined>;
  signal?: AbortSignal;
  timeout?: number;
  validateStatus?: (status: number) => boolean;
  logResponseBody?: boolean;
  params?: unknown;
}

interface CapturedRequest {
  method: string;
  url: string;
  data?: unknown;
  config: RequestConfig;
}

interface HttpResponse {
  data: unknown;
  status: number;
  headers: Record<string, string>;
  config?: RequestConfig;
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const response = (data: unknown = {}): HttpResponse => ({
  data,
  status: 200,
  headers: { "x-request-id": "test-request" },
});

const unauthorized = () =>
  new AxiosError(
    "Request failed with status code 401",
    undefined,
    undefined,
    undefined,
    {
      data: { message: "unauthorized" },
      status: 401,
      statusText: "Unauthorized",
      headers: {},
      config: { headers: {} },
    } as AxiosResponse
  );

const accessToken = (userId: string, revision = "initial") =>
  jwt.sign({ userId, revision }, "hydra-api-test-signing-key", {
    noTimestamp: true,
  });

const authUri = (userId: string, expiresIn = 3600) => {
  const payload = Buffer.from(
    JSON.stringify({
      accessToken: accessToken(userId),
      refreshToken: `refresh-for-${userId}`,
      workwondersJwt: `workwonders-for-${userId}`,
      expiresIn,
    })
  ).toString("base64");
  return `hydra://auth?payload=${encodeURIComponent(payload)}`;
};

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-api-regression-")
  );
  const id = randomUUID();
  const globalRegistry = globalThis as unknown as Record<string, unknown>;
  const registry = (globalRegistry[registryKey] ??= new Map<
    string,
    unknown
  >()) as Map<string, unknown>;
  const values = new Map<string, unknown>();
  const requests: CapturedRequest[] = [];
  const effects: string[] = [];
  const logs: unknown[][] = [];
  const requestInterceptors: Array<
    (config: Record<string, unknown>) => Record<string, unknown>
  > = [];
  const responseInterceptors: Array<{
    fulfilled: (value: HttpResponse) => HttpResponse;
    rejected: (error: unknown) => Promise<never>;
  }> = [];
  let onRequest = async (_request: CapturedRequest) => response();
  let beforePut = async (_key: string, _value: unknown) => {};
  let beforeBatch = async () => {};
  let getUserData = async (): Promise<{ subscription: null } | null> => null;

  const dispatch = async (
    method: string,
    url: string,
    data: unknown,
    config: RequestConfig = {}
  ) => {
    let intercepted: Record<string, unknown> = {
      ...config,
      method,
      url,
      data,
      baseURL: apiEnvironment,
    };
    for (const interceptor of requestInterceptors) {
      intercepted = interceptor(intercepted);
    }
    const request: CapturedRequest = {
      method,
      url,
      data,
      config: intercepted as RequestConfig,
    };
    requests.push(request);
    try {
      let result = { ...(await onRequest(request)), config: request.config };
      for (const interceptor of responseInterceptors) {
        result = interceptor.fulfilled(result) as typeof result;
      }
      return result;
    } catch (error) {
      let rejected = error;
      for (const interceptor of responseInterceptors) {
        try {
          await interceptor.rejected(rejected);
        } catch (next) {
          rejected = next;
        }
      }
      throw rejected;
    }
  };

  const harness = {
    AxiosError,
    client: {
      interceptors: {
        request: {
          use: (
            fulfilled: (
              config: Record<string, unknown>
            ) => Record<string, unknown>
          ) => requestInterceptors.push(fulfilled),
        },
        response: {
          use: (
            fulfilled: (value: HttpResponse) => HttpResponse,
            rejected: (error: unknown) => Promise<never>
          ) => responseInterceptors.push({ fulfilled, rejected }),
        },
      },
      get: (url: string, config: RequestConfig) =>
        dispatch("get", url, undefined, config),
      post: (url: string, data: unknown, config: RequestConfig) =>
        dispatch("post", url, data, config),
      put: (url: string, data: unknown, config: RequestConfig) =>
        dispatch("put", url, data, config),
      patch: (url: string, data: unknown, config: RequestConfig) =>
        dispatch("patch", url, data, config),
      delete: (url: string, config: RequestConfig) =>
        dispatch("delete", url, undefined, config),
    },
    db: {
      getMany: async (keys: string[]) => keys.map((key) => values.get(key)),
      get: async (key: string) => {
        if (!values.has(key))
          throw Object.assign(new Error("Not found"), {
            code: "LEVEL_NOT_FOUND",
          });
        return values.get(key);
      },
      put: async (key: string, value: unknown) => {
        await beforePut(key, value);
        values.set(key, value);
      },
      batch: async (operations: Array<{ type: string; key: string }>) => {
        await beforeBatch();
        for (const operation of operations) {
          if (operation.type === "del") values.delete(operation.key);
        }
      },
    },
    WindowManager: {
      mainWindow: null,
      sendToAppWindows: (event: string) => effects.push(event),
    },
    logger: {
      log: (...args: unknown[]) => logs.push(args),
      error: (...args: unknown[]) => logs.push(args),
      info: (...args: unknown[]) => logs.push(args),
    },
    effects,
    getUserData: () => getUserData(),
    clearGamesRemoteIds: async () => {},
  };
  registry.set(id, harness);
  t.after(async () => {
    registry.delete(id);
    await fs.rm(root, { recursive: true, force: true });
  });

  const stubs: Record<string, string> = {
    axios:
      "export const AxiosError = harness.AxiosError; export default { create: () => harness.client };",
    "./window-manager": "export const WindowManager = harness.WindowManager;",
    "./library-sync": "export const uploadGamesBatch = async () => {};",
    "./library-sync/clear-games-remote-id":
      "export const clearGamesRemoteIds = harness.clearGamesRemoteIds;",
    "./logger": "export const networkLogger = harness.logger;",
    "@shared": `export class UserNotLoggedInError extends Error { constructor() { super('user not logged in'); this.name = 'UserNotLoggedInError'; } } export class SubscriptionRequiredError extends Error { constructor() { super('subscription required'); this.name = 'SubscriptionRequiredError'; } }`,
    "@main/constants": "export const appVersion = 'test';",
    "./user/get-user-data": "export const getUserData = harness.getUserData;",
    "@main/level": "export const db = harness.db;",
    "@main/level/sublevels":
      "export const levelKeys = { auth: 'auth', user: 'user' };",
    "./sse":
      "export const SSEClient = { close() { harness.effects.push('sse-close'); }, connect() { harness.effects.push('sse-connect'); } };",
    "./achievements/achievement-watcher-manager":
      "export const AchievementWatcherManager = { resetSessionState() { harness.effects.push('watcher-reset'); } };",
    "./achievements/grouped-souvenir-worker":
      "export const groupedSouvenirWorker = { trigger() { harness.effects.push('worker-start'); }, stop() { harness.effects.push('worker-stop'); } };",
    "./linux-game-capture-session":
      "export const stopAllLinuxGameCaptureSessions = () => harness.effects.push('capture-stop');",
    "./steam-integration/steam-startup-sync":
      "export const startSteamSyncOnStartup = () => harness.effects.push('steam-start'); export const resetSteamStartupSync = () => harness.effects.push('steam-reset');",
    "./user": "export const syncDownloadSourcesFromApi = async () => {};",
  };
  const bundlePath = path.join(root, "hydra-api.mjs");
  // Bundle the actual API class and auth tracker. Only environment boundaries are
  // replaced, so tests execute request validation, refresh and persistence logic.
  await build({
    entryPoints: [fileURLToPath(new URL("./hydra-api.ts", import.meta.url))],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define: {
      "import.meta.env.MAIN_VITE_API_URL": JSON.stringify(apiEnvironment),
    },
    plugins: [
      {
        name: "hydra-api-environment-stubs",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "jsonwebtoken") {
              return {
                path: pathToFileURL(require.resolve("jsonwebtoken")).href,
                external: true,
              };
            }
            if (Object.hasOwn(stubs, args.path)) {
              return { path: args.path, namespace: "hydra-api-test" };
            }
            return undefined;
          });
          builder.onLoad(
            { filter: /.*/, namespace: "hydra-api-test" },
            (args) => ({
              contents: `const harness = globalThis[${JSON.stringify(registryKey)}].get(${JSON.stringify(id)}); ${stubs[args.path]}`,
              loader: "js",
            })
          );
        },
      },
    ],
  });
  const { HydraApi } = (await import(
    pathToFileURL(bundlePath).href
  )) as typeof import("./hydra-api");
  await HydraApi.setupApi();
  requests.length = 0;
  effects.length = 0;
  logs.length = 0;
  return {
    api: HydraApi,
    requests,
    effects,
    logs,
    values,
    signIn: (userId: string, expiresIn = 3600) =>
      HydraApi.handleExternalAuth(authUri(userId, expiresIn)),
    onRequest: (handler: typeof onRequest) => {
      onRequest = handler;
    },
    beforePut: (handler: typeof beforePut) => {
      beforePut = handler;
    },
    beforeBatch: (handler: typeof beforeBatch) => {
      beforeBatch = handler;
    },
    getUserData: (handler: typeof getUserData) => {
      getUserData = handler;
    },
  };
}

test("refresh A completing after logout and B login cannot replace B token or sign out B", async (t) => {
  for (const status of [200, 401]) {
    const f = await fixture(t);
    await f.signIn("HydraA", 1);
    const started = deferred<void>();
    const refresh = deferred<HttpResponse>();
    f.onRequest(async (request) => {
      if (request.url === "/auth/refresh") {
        assert.deepEqual(request.data, { refreshToken: "refresh-for-HydraA" });
        assert.equal(request.config.timeout, 20_000);
        started.resolve();
        return refresh.promise;
      }
      return response();
    });
    const oldContext = f.api.getAuthContext()!;
    const attempt = f.api
      .post(
        endpoint,
        { exchangeCode: "one-use-proof" },
        {
          authContext: oldContext,
          timeout: 20_000,
        }
      )
      .then(
        () => null,
        (error: unknown) => error
      );
    await started.promise;
    await f.api.handleSignOut();
    await f.signIn("HydraB");
    const signouts = f.effects.filter((event) => event === "on-signout").length;
    if (status === 200)
      refresh.resolve(
        response({
          accessToken: accessToken("HydraA", "late-refresh"),
          expiresIn: 3600,
        })
      );
    else refresh.reject(unauthorized());
    assert.ok((await attempt) instanceof Error);
    assert.equal(f.api.getAuthContext()?.userId, "HydraB");
    assert.equal(f.api.isLoggedIn(), true);
    assert.equal(
      (f.values.get("auth") as Auth).accessToken,
      accessToken("HydraB")
    );
    assert.equal(
      f.effects.filter((event) => event === "on-signout").length,
      signouts
    );
    assert.equal(
      f.requests.filter((request) => request.url === endpoint).length,
      0
    );
  }
});

test("stalled A auth persistence completes before B write and final stored credentials belong to B", async (t) => {
  const f = await fixture(t);
  const started = deferred<void>();
  const stalled = deferred<void>();
  f.beforePut(async (key, value) => {
    if (
      key === "auth" &&
      (value as Auth).refreshToken === "refresh-for-HydraA"
    ) {
      started.resolve();
      await stalled.promise;
    }
  });
  const signInA = f.signIn("HydraA");
  await started.promise;
  const activeB = deferred<void>();
  const unsubscribe = f.api.onAuthContextChanged(() => {
    if (f.api.getAuthContext()?.userId === "HydraB") activeB.resolve();
  });
  const signInB = f.signIn("HydraB");
  await activeB.promise;
  stalled.resolve();
  await Promise.all([signInA, signInB]);
  unsubscribe();
  assert.equal(f.api.getAuthContext()?.userId, "HydraB");
  assert.equal(
    (f.values.get("auth") as Auth).refreshToken,
    "refresh-for-HydraB"
  );
  assert.equal(
    (f.values.get("auth") as Auth).accessToken,
    accessToken("HydraB")
  );
});

test("logout waits for an in-flight refresh write then removes credentials before restart", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA");
  const renewed = accessToken("HydraA", "persisting-refresh");
  const writing = deferred<void>();
  const completeWrite = deferred<void>();
  f.beforePut(async (key, value) => {
    if (key === "auth" && (value as Auth).accessToken === renewed) {
      writing.resolve();
      await completeWrite.promise;
    }
  });
  f.onRequest(async () => response({ accessToken: renewed, expiresIn: 3600 }));
  const refresh = f.api.refreshToken().then(
    () => null,
    (error: unknown) => error
  );
  await writing.promise;
  const logout = f.api.handleSignOut();
  assert.equal(f.api.isLoggedIn(), false);
  completeWrite.resolve();
  assert.equal(((await refresh) as Error).name, "UserNotLoggedInError");
  await logout;
  assert.equal(f.values.has("auth"), false);
  assert.equal(f.values.has("user"), false);
  await f.api.setupApi();
  assert.equal(f.api.isLoggedIn(), false);
  assert.equal(f.api.getAuthContext(), null);
});

test("logout during initial login persistence cannot resurrect that login", async (t) => {
  const f = await fixture(t);
  const writing = deferred<void>();
  const completeWrite = deferred<void>();
  f.beforePut(async (key) => {
    if (key === "auth") {
      writing.resolve();
      await completeWrite.promise;
    }
  });
  const login = f.signIn("HydraA");
  await writing.promise;
  const logout = f.api.handleSignOut();
  completeWrite.resolve();
  await Promise.all([login, logout]);
  assert.equal(f.api.isLoggedIn(), false);
  assert.equal(f.values.has("auth"), false);
});

test("a delayed 401 deletion finishes before B auth and cache writes", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA");
  const deleting = deferred<void>();
  const completeDelete = deferred<void>();
  f.beforeBatch(async () => {
    deleting.resolve();
    await completeDelete.promise;
  });
  f.onRequest(async () => {
    throw unauthorized();
  });
  const request = f.api.get("/expired-session").then(
    () => null,
    (error: unknown) => error
  );
  await deleting.promise;
  const activeB = deferred<void>();
  const unsubscribe = f.api.onAuthContextChanged(() => {
    if (f.api.getAuthContext()?.userId === "HydraB") activeB.resolve();
  });
  const loginB = f.signIn("HydraB");
  await activeB.promise;
  const userB = {
    id: "HydraB",
    displayName: "B",
    profileImageUrl: null,
    backgroundImageUrl: null,
    subscription: null,
  };
  const writeUserB = f.api.persistUserCache(userB, f.api.getAuthContext()!);
  completeDelete.resolve();
  assert.ok((await request) instanceof AxiosError);
  await Promise.all([loginB, writeUserB]);
  unsubscribe();
  assert.equal(
    (f.values.get("auth") as Auth).refreshToken,
    "refresh-for-HydraB"
  );
  assert.deepEqual(f.values.get("user"), userB);
  assert.equal(f.api.getAuthContext()?.userId, "HydraB");
  assert.equal(f.effects.includes("on-signout"), false);
});

test("queued logout data cleanup completes before a later login persists", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA");
  const cleanupStarted = deferred<void>();
  const completeCleanup = deferred<void>();
  let cleanupFinished = false;
  f.beforePut(async (key, value) => {
    if (
      key === "auth" &&
      (value as Auth).refreshToken === "refresh-for-HydraB"
    ) {
      assert.equal(cleanupFinished, true);
    }
  });
  const logout = f.api.handleSignOut(async () => {
    cleanupStarted.resolve();
    await completeCleanup.promise;
    cleanupFinished = true;
  });
  await cleanupStarted.promise;
  const loginB = f.signIn("HydraB");
  completeCleanup.resolve();
  await Promise.all([logout, loginB]);
  assert.equal(f.api.getAuthContext()?.userId, "HydraB");
  assert.equal(
    (f.values.get("auth") as Auth).refreshToken,
    "refresh-for-HydraB"
  );
  assert.equal(f.effects.includes("on-signout"), false);
});

test("stalled A user cache write is cleared before B cache becomes persistent", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA");
  const writing = deferred<void>();
  const completeWrite = deferred<void>();
  f.beforePut(async (key, value) => {
    if (key === "user" && (value as { id?: string }).id === "HydraA") {
      writing.resolve();
      await completeWrite.promise;
    }
  });
  const userA = {
    id: "HydraA",
    displayName: "A",
    profileImageUrl: null,
    backgroundImageUrl: null,
    subscription: null,
  };
  const writeA = f.api.persistUserCache(userA, f.api.getAuthContext()!).then(
    () => null,
    (error: unknown) => error
  );
  await writing.promise;
  const logout = f.api.handleSignOut();
  const activeB = deferred<void>();
  const unsubscribe = f.api.onAuthContextChanged(() => {
    if (f.api.getAuthContext()?.userId === "HydraB") activeB.resolve();
  });
  const loginB = f.signIn("HydraB");
  await activeB.promise;
  const userB = { ...userA, id: "HydraB", displayName: "B" };
  const writeB = f.api.persistUserCache(userB, f.api.getAuthContext()!);
  completeWrite.resolve();
  assert.equal(((await writeA) as Error).name, "UserNotLoggedInError");
  await Promise.all([logout, loginB, writeB]);
  unsubscribe();
  assert.deepEqual(f.values.get("user"), userB);
  assert.equal(
    (f.values.get("auth") as Auth).refreshToken,
    "refresh-for-HydraB"
  );
});

test("switching accounts during expired-token refresh never dispatches Epic proof with B bearer", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA", 1);
  const started = deferred<void>();
  const refresh = deferred<HttpResponse>();
  f.onRequest(async (request) => {
    if (request.url === "/auth/refresh") {
      started.resolve();
      return refresh.promise;
    }
    return response();
  });
  const attempt = f.api
    .post(
      endpoint,
      { exchangeCode: "proof-for-A" },
      {
        authContext: f.api.getAuthContext()!,
      }
    )
    .then(
      () => null,
      (error: unknown) => error
    );
  await started.promise;
  await f.signIn("HydraB");
  refresh.resolve(
    response({
      accessToken: accessToken("HydraA", "refreshed"),
      expiresIn: 3600,
    })
  );
  assert.equal(((await attempt) as Error).name, "UserNotLoggedInError");
  assert.equal(
    f.requests.some((request) => request.url === endpoint),
    false
  );
  await f.api.get("/current-user-probe");
  assert.equal(
    f.requests.at(-1)?.config.headers?.Authorization,
    `Bearer ${accessToken("HydraB")}`
  );
});

test("late API responses from A cannot return profile data or invalidate B credentials", async (t) => {
  for (const status of [200, 401]) {
    const f = await fixture(t);
    await f.signIn("HydraA");
    const started = deferred<void>();
    const remote = deferred<HttpResponse>();
    f.onRequest(async (request) => {
      if (request.url === "/profile/me") {
        assert.equal(
          request.config.headers?.Authorization,
          `Bearer ${accessToken("HydraA")}`
        );
        started.resolve();
        return remote.promise;
      }
      return response();
    });
    const attempt = f.api.get("/profile/me").then(
      () => null,
      (error: unknown) => error
    );
    await started.promise;
    await f.signIn("HydraB");
    if (status === 200) remote.resolve(response({ id: "HydraA" }));
    else remote.reject(unauthorized());
    assert.ok((await attempt) instanceof Error);
    assert.equal(f.api.getAuthContext()?.userId, "HydraB");
    assert.equal(
      (f.values.get("auth") as Auth).refreshToken,
      "refresh-for-HydraB"
    );
    assert.equal(f.effects.includes("on-signout"), false);
  }
});

test("aborting Epic while awaiting shared refresh prevents POST while refresh remains usable", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA", 1);
  const started = deferred<void>();
  const refresh = deferred<HttpResponse>();
  f.onRequest(async (request) => {
    if (request.url === "/auth/refresh") {
      started.resolve();
      return refresh.promise;
    }
    return response();
  });
  const controller = new AbortController();
  const attempt = f.api
    .post(
      endpoint,
      { exchangeCode: "cancelled-proof" },
      {
        authContext: f.api.getAuthContext()!,
        signal: controller.signal,
        timeout: 20_000,
      }
    )
    .then(
      () => null,
      (error: unknown) => error
    );
  await started.promise;
  const shared = f.api.refreshToken();
  controller.abort();
  assert.equal(((await attempt) as { code?: string }).code, "ERR_CANCELED");
  assert.equal(
    f.requests.some((request) => request.url === endpoint),
    false
  );
  const renewed = accessToken("HydraA", "after-cancellation");
  refresh.resolve(response({ accessToken: renewed, expiresIn: 3600 }));
  assert.equal((await shared).accessToken, renewed);
  assert.equal(f.api.getAuthContext()?.userId, "HydraA");
  assert.equal((f.values.get("auth") as Auth).accessToken, renewed);
  assert.equal(
    f.requests.filter((request) => request.url === "/auth/refresh").length,
    1
  );
  assert.equal(
    f.requests.some((request) => request.url === endpoint),
    false
  );
});

test("Epic refresh wait timeout remains scoped and never submits proof afterwards", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA", 1);
  const started = deferred<void>();
  const refresh = deferred<HttpResponse>();
  f.onRequest(async (request) => {
    if (request.url === "/auth/refresh") {
      started.resolve();
      return refresh.promise;
    }
    return response();
  });
  const attempt = f.api
    .post(
      endpoint,
      { exchangeCode: "timed-out-proof" },
      {
        authContext: f.api.getAuthContext()!,
        timeout: 5,
      }
    )
    .then(
      () => null,
      (error: unknown) => error
    );
  await started.promise;
  const shared = f.api.refreshToken();
  assert.equal(((await attempt) as { code?: string }).code, "ETIMEDOUT");
  refresh.resolve(
    response({ accessToken: accessToken("HydraA", "late"), expiresIn: 3600 })
  );
  await shared;
  assert.equal(f.api.isLoggedIn(), true);
  assert.equal(
    f.requests.some((request) => request.url === endpoint),
    false
  );
});

test("401 from a public request preserves Hydra login and current authenticated 401 signs out", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA");
  f.onRequest(async () => {
    throw unauthorized();
  });
  await assert.rejects(
    f.api.get("/public-endpoint", undefined, { needsAuth: false }),
    AxiosError
  );
  assert.equal(f.api.isLoggedIn(), true);
  assert.equal(f.api.getAuthContext()?.userId, "HydraA");
  assert.equal(f.effects.includes("on-signout"), false);
  await assert.rejects(f.api.get("/profile/me"), AxiosError);
  assert.equal(f.api.isLoggedIn(), false);
  assert.equal(f.api.getAuthContext(), null);
  assert.equal(f.values.has("auth"), false);
  assert.equal(f.effects.filter((event) => event === "on-signout").length, 1);
  const logged = JSON.stringify(f.logs);
  assert.equal(logged.includes("refresh-for-HydraA"), false);
  assert.equal(logged.includes(accessToken("HydraA")), false);
});

test("existing HTTP methods preserve bearer, payload, conditional headers and response contracts", async (t) => {
  const f = await fixture(t);
  await f.signIn("HydraA");
  const expected = { connected: false };
  f.onRequest(async () => response(expected));
  const conditional = new Date("2026-10-07T15:00:00.000Z");
  assert.deepEqual(
    await f.api.get(
      endpoint,
      { page: 1 },
      { ifModifiedSince: conditional, ifNoneMatch: "etag" }
    ),
    expected
  );
  assert.deepEqual(f.requests.at(-1)?.config.params, { page: 1 });
  assert.equal(
    f.requests.at(-1)?.config.headers?.["Hydra-If-Modified-Since"],
    conditional.toUTCString()
  );
  assert.equal(f.requests.at(-1)?.config.headers?.["If-None-Match"], "etag");
  assert.deepEqual(await f.api.getResponse(endpoint), {
    status: 200,
    data: expected,
    headers: { "x-request-id": "test-request" },
  });
  assert.deepEqual(
    await f.api.post(
      endpoint,
      { value: 1 },
      { timeout: 20_000, logResponseBody: false }
    ),
    expected
  );
  assert.equal(f.requests.at(-1)?.config.timeout, 20_000);
  assert.equal(f.requests.at(-1)?.config.logResponseBody, false);
  assert.deepEqual(await f.api.postResponse(endpoint, { value: 2 }), {
    status: 200,
    data: expected,
  });
  assert.deepEqual(await f.api.put(endpoint, { value: 3 }), expected);
  assert.deepEqual(await f.api.patch(endpoint, { value: 4 }), expected);
  assert.deepEqual(await f.api.delete(endpoint), expected);
  assert.deepEqual(
    f.requests
      .filter((request) => request.url === endpoint)
      .map((request) => request.method),
    ["get", "get", "post", "post", "put", "patch", "delete"]
  );
  for (const request of f.requests.filter(
    (request) => request.url === endpoint
  )) {
    assert.equal(
      request.config.headers?.Authorization,
      `Bearer ${accessToken("HydraA")}`
    );
  }
});
