import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, it } from "node:test";
import ts from "typescript";
import * as axios from "axios";
import { getRetryAfterMs } from "./retry-after.ts";

type Requests = {
  fetch: <T>(
    context: { environment: string; userId: string; generation: number } | null,
    shop: string,
    objectId: string,
    language: string,
    request: () => Promise<T>
  ) => Promise<T | null>;
  clear: () => void;
};

const MINUTE = 60_000;
const owner = { environment: "production", userId: "A", generation: 1 };
const realNow = Date.now;
let now = 0;

const load = () => {
  const output = ts.transpileModule(
    readFileSync(
      new URL("./combined-achievements-requests.ts", import.meta.url),
      "utf8"
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const stubs: Record<string, unknown> = {
    axios,
    "../logger": { achievementsLogger: { warn: () => undefined } },
    "./retry-after": { getRetryAfterMs },
  };
  const exported = {} as { CombinedAchievementsRequests: Requests };
  new Function("exports", "require", output)(exported, (name: string) => {
    assert.ok(name in stubs, name);
    return stubs[name];
  });
  return exported.CombinedAchievementsRequests;
};

const httpError = (status: number, headers: Record<string, string> = {}) =>
  new axios.AxiosError("failed", undefined, undefined, undefined, {
    status,
    statusText: "",
    headers,
    config: {} as never,
    data: null,
  });

const counter = (result: () => Promise<unknown>) => {
  const state = { calls: 0 };
  return Object.assign(state, {
    request: () => {
      state.calls++;
      return result();
    },
  });
};

beforeEach(() => {
  now = 1_000_000;
  Date.now = () => now;
});

afterEach(() => {
  Date.now = realNow;
});

it("backs off 1, 5 and then 30 minutes after repeated 503s", async () => {
  const requests = load();
  const api = counter(() => Promise.reject(httpError(503)));
  const call = () => requests.fetch(owner, "steam", "10", "en", api.request);

  for (const delay of [MINUTE, 5 * MINUTE, 30 * MINUTE, 30 * MINUTE]) {
    const before = api.calls;
    assert.equal(await call(), null);
    assert.equal(api.calls, before + 1);
    now += delay - 1;
    assert.equal(await call(), null);
    assert.equal(api.calls, before + 1);
    now += 1;
  }
});

it("starts the ladder over after a success", async () => {
  const requests = load();
  let fail = true;
  const api = counter(() =>
    fail ? Promise.reject(httpError(503)) : Promise.resolve("union")
  );
  const call = () => requests.fetch(owner, "steam", "10", "en", api.request);

  await call();
  now += MINUTE;
  await call();
  now += 5 * MINUTE;
  fail = false;
  assert.equal(await call(), "union");
  fail = true;
  await call();
  now += MINUTE;
  await call();
  assert.equal(api.calls, 5);
});

it("honours Retry-After and caps it at 30 minutes", async () => {
  const requests = load();
  const longer = counter(() =>
    Promise.reject(httpError(503, { "retry-after": "120" }))
  );
  await requests.fetch(owner, "steam", "10", "en", longer.request);
  now += 2 * MINUTE - 1;
  await requests.fetch(owner, "steam", "10", "en", longer.request);
  assert.equal(longer.calls, 1);
  now += 1;
  await requests.fetch(owner, "steam", "10", "en", longer.request);
  assert.equal(longer.calls, 2);

  const capped = counter(() =>
    Promise.reject(httpError(429, { "retry-after": String(2 * 60 * 60) }))
  );
  await requests.fetch(owner, "steam", "20", "en", capped.request);
  now += 30 * MINUTE;
  await requests.fetch(owner, "steam", "20", "en", capped.request);
  assert.equal(capped.calls, 2);
});

// HydraApi rethrows errors without a response this way.
const requestError = (code: string) =>
  Object.assign(new Error(`Request failed with ${code} failed`), { code });

it("does not back off on 401, offline errors or cancelled requests", async () => {
  const offline = new axios.AxiosError("Network Error", "ERR_NETWORK");
  for (const error of [
    httpError(401),
    offline,
    requestError("ERR_NETWORK"),
    new Error("achievement-owner-changed"),
  ]) {
    const requests = load();
    const api = counter(() => Promise.reject(error));
    await requests.fetch(owner, "steam", "10", "en", api.request);
    await requests.fetch(owner, "steam", "10", "en", api.request);
    assert.equal(api.calls, 2);
  }
});

it("backs off after a request timeout", async () => {
  for (const error of [
    new axios.AxiosError("timeout", "ECONNABORTED"),
    requestError("ECONNABORTED"),
    requestError("ETIMEDOUT"),
  ]) {
    const requests = load();
    const api = counter(() => Promise.reject(error));
    await requests.fetch(owner, "steam", "10", "en", api.request);
    await requests.fetch(owner, "steam", "10", "en", api.request);
    assert.equal(api.calls, 1);
  }
});

it("ignores requests that finish after clear()", async () => {
  const requests = load();
  let reject!: (error: unknown) => void;
  const stale = requests.fetch(
    owner,
    "steam",
    "10",
    "en",
    () => new Promise((_, fail) => (reject = fail))
  );
  requests.clear();
  reject(httpError(503));
  assert.equal(await stale, null);

  const api = counter(() => Promise.resolve("union"));
  assert.equal(
    await requests.fetch(owner, "steam", "10", "en", api.request),
    "union"
  );
  assert.equal(api.calls, 1);
});

it("shares an in-flight request per game and language", async () => {
  const requests = load();
  const resolvers: ((value: string) => void)[] = [];
  let gated = true;
  const api = counter(() =>
    gated
      ? new Promise<string>((done) => resolvers.push(done))
      : Promise.resolve("union")
  );
  const first = requests.fetch(owner, "steam", "10", "en", api.request);
  const second = requests.fetch(owner, "steam", "10", "en", api.request);
  const otherLanguage = requests.fetch(owner, "steam", "10", "pt", api.request);
  assert.equal(api.calls, 2);
  gated = false;
  for (const resolve of resolvers) resolve("union");
  assert.equal(await first, await second);
  await otherLanguage;
  await requests.fetch(owner, "steam", "10", "en", api.request);
  assert.equal(api.calls, 3);
});

it("keeps each account's backoff apart and clears it on reset", async () => {
  const requests = load();
  const api = counter(() => Promise.reject(httpError(503)));
  await requests.fetch(owner, "steam", "10", "en", api.request);
  await requests.fetch(
    { ...owner, userId: "B" },
    "steam",
    "10",
    "en",
    api.request
  );
  await requests.fetch(
    { ...owner, environment: "staging" },
    "steam",
    "10",
    "en",
    api.request
  );
  assert.equal(api.calls, 3);

  await requests.fetch(owner, "steam", "10", "en", api.request);
  assert.equal(api.calls, 3);
  requests.clear();
  await requests.fetch(owner, "steam", "10", "en", api.request);
  assert.equal(api.calls, 4);
});
