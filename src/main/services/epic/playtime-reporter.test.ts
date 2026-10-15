import assert from "node:assert/strict";
import test from "node:test";
import { EpicPlaytimeReporter } from "./playtime-reporter.js";
import type { EpicManagedTarget } from "./legendary-managed-runtime";
import type { EpicErrorCode } from "../../../types/epic-integration.types";
import { connection, deferred } from "./store-test-helpers.js";

const base = Date.parse("2026-10-14T12:00:00Z");
function fixture(timeout = 1000) {
  const target = {
    auth: { environment: "https://api.test", userId: "A", generation: 1 },
    connection: { ...connection },
    artifactId: "Artifact",
  } as EpicManagedTarget;
  const state = {
    elapsed: 0,
    current: true,
    active: structuredClone(target),
    requests: [] as {
      url: string;
      options: RequestInit;
      body: {
        playtimeAddList: {
          artifactId: string;
          machineId: string;
          startTime: string;
          endTime: string;
          startSegment: boolean;
          endSegment: boolean;
        }[];
      };
    }[],
    refreshes: [] as boolean[],
    confirmed: 0,
    errors: [] as EpicErrorCode[],
    fetch: async (): Promise<Response> => new Response(null, { status: 204 }),
    token: async (force: boolean): Promise<string> =>
      force ? "rotated-token" : "private-token",
    reconcile: async () => {},
  };
  const reporter = new EpicPlaytimeReporter({
    timeout,
    now: () => base + state.elapsed,
    monotonic: () => state.elapsed,
    current: (captured) =>
      state.current &&
      captured.auth.userId === state.active.auth.userId &&
      captured.auth.environment === state.active.auth.environment &&
      captured.auth.generation === state.active.auth.generation &&
      captured.connection.connectionId ===
        state.active.connection.connectionId &&
      captured.connection.epicAccountId ===
        state.active.connection.epicAccountId,
    session: {
      token: async (_auth, _connection, _signal, force = false) => {
        state.refreshes.push(force);
        return state.token(force);
      },
    },
    fetch: async (url, options) => {
      state.requests.push({
        url: String(url),
        options: options!,
        body: JSON.parse(options!.body as string),
      });
      return state.fetch();
    },
    confirmed: async () => {
      state.confirmed++;
      await state.reconcile();
    },
    error: (_objectId, code) => state.errors.push(code),
  });
  const session = reporter.begin("Namespace:Item", target);
  const advance = (ms: number, observe = true) => {
    if (!observe) {
      state.elapsed += ms;
      return;
    }
    while (ms > 0) {
      const step = Math.min(ms, 2000);
      state.elapsed += step;
      reporter.observe(session);
      ms -= step;
    }
  };
  return { reporter, session, state, target, advance };
}
const durations = (f: ReturnType<typeof fixture>) =>
  f.state.requests.map(({ body }) => {
    const row = body.playtimeAddList[0];
    return (Date.parse(row.endTime) - Date.parse(row.startTime)) / 1000;
  });

test("playtime resumes for new sessions after an aborted shutdown without replaying drained intervals", async () => {
  const f = fixture();
  f.advance(2000);
  await f.reporter.drain();
  f.reporter.restoreAfterFailedShutdown();
  const next = f.reporter.begin("Namespace:Item", f.session.target);
  f.state.elapsed += 2000;
  f.reporter.observe(next);
  f.reporter.finish(next);
  await f.reporter.idle();
  assert.equal(f.state.requests.length, 2);
  const first = f.state.requests[0].body.playtimeAddList[0];
  const second = f.state.requests[1].body.playtimeAddList[0];
  assert.equal(first.endTime, second.startTime);
  assert.equal(Date.parse(second.endTime) - Date.parse(second.startTime), 2000);
});

test("consecutive observed intervals and final remainder are disjoint, whole seconds and sent once", async () => {
  const f = fixture();
  f.advance(60000);
  await f.reporter.idle();
  f.advance(10050);
  f.reporter.finish(f.session);
  f.reporter.finish(f.session);
  f.reporter.observe(f.session);
  await f.reporter.idle();
  assert.deepEqual(durations(f), [60, 10]);
  const [first, second] = f.state.requests.map(
    (r) => r.body.playtimeAddList[0]
  );
  assert.equal(first.endTime, second.startTime);
  assert.match(
    first.machineId,
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
  );
  assert.equal(first.machineId, second.machineId);
  assert.equal(first.artifactId, "Artifact");
  assert.equal(first.startSegment, true);
  assert.equal(first.endSegment, true);
  assert.equal(f.state.requests[0].options.method, "PUT");
  assert.equal(f.state.requests[0].options.redirect, "error");
  assert.equal(
    f.state.requests[0].url.endsWith(
      `/account/${connection.epicAccountId}/bulk`
    ),
    true
  );
  assert.equal(f.state.confirmed, 2);
  assert.deepEqual(f.state.errors, []);
});

test("suspend and invalid inspection finish only observed time; resumed observations skip the gap", async () => {
  for (const suspend of [true, false]) {
    const f = fixture();
    f.advance(10000);
    if (suspend) f.reporter.suspend();
    else f.reporter.interruptAll();
    await f.reporter.idle();
    f.advance(3600000, false);
    if (suspend) {
      f.reporter.observe(f.session);
      assert.equal(f.session.segment, null);
      f.reporter.resume();
    }
    f.reporter.observe(f.session);
    f.advance(10000);
    f.reporter.finish(f.session);
    await f.reporter.idle();
    assert.deepEqual(durations(f), [10, 10]);
    assert.equal(
      f.state.requests[1].body.playtimeAddList[0].startTime,
      new Date(base + 3610000).toISOString()
    );
  }
});

test("stalled observation and backwards wall clock never fill a gap or overlap an earlier interval", async () => {
  const f = fixture();
  f.advance(10000);
  f.advance(20000, false);
  f.reporter.observe(f.session);
  f.advance(10000);
  f.reporter.finish(f.session);
  await f.reporter.idle();
  assert.deepEqual(durations(f), [10, 10]);
  assert.equal(
    f.state.requests[1].body.playtimeAddList[0].startTime,
    new Date(base + 30000).toISOString()
  );
  const backwards = fixture();
  backwards.advance(10000);
  backwards.reporter.interruptAll();
  backwards.state.elapsed = 0;
  backwards.reporter.observe(backwards.session);
  backwards.reporter.finish(backwards.session);
  await backwards.reporter.idle();
  assert.deepEqual(durations(backwards), [10]);
});

test("only an explicit first 401 refreshes the session and repeats the identical payload", async () => {
  const f = fixture();
  let count = 0;
  f.state.fetch = async () =>
    new Response(null, { status: ++count === 1 ? 401 : 204 });
  f.advance(10000);
  f.reporter.finish(f.session);
  await f.reporter.idle();
  assert.deepEqual(f.state.refreshes, [false, true]);
  assert.equal(
    f.state.requests[0].options.body,
    f.state.requests[1].options.body
  );
  assert.equal(
    (f.state.requests[1].options.headers as Record<string, string>)
      .Authorization,
    "Bearer rotated-token"
  );
  assert.equal(f.state.confirmed, 1);
});

test("401 after refresh, forbidden, rate limit, server error and lost response never replay a submitted interval", async () => {
  for (const status of [401, 403, 429, 500, 502, 0]) {
    const f = fixture();
    f.state.fetch = async () => {
      if (!status) throw new Error("private response details must not escape");
      return new Response(null, { status });
    };
    f.advance(60000);
    await f.reporter.idle();
    const attempts = status === 401 ? 2 : 1;
    assert.equal(f.state.requests.length, attempts);
    f.advance(10000);
    f.reporter.finish(f.session);
    await f.reporter.idle();
    assert.equal(f.state.requests.length, attempts * 2);
    assert.equal(
      f.state.requests[attempts].body.playtimeAddList[0].startTime,
      new Date(base + 60000).toISOString()
    );
    assert.equal(f.state.confirmed, 0);
    assert.equal(f.state.errors.length, 2);
    assert.equal(
      f.state.errors.some((code) => code.includes("private")),
      false
    );
  }
});

test("a timed out request advances its interval once and does not block the watcher or shutdown", async () => {
  const f = fixture(10);
  f.state.fetch = () => new Promise(() => {});
  f.advance(60000);
  await f.reporter.idle();
  assert.equal(f.state.requests.length, 1);
  assert.deepEqual(f.state.errors, ["timeout"]);
  f.advance(10000);
  await f.reporter.drain();
  assert.equal(f.state.requests.length, 2);
  assert.deepEqual(durations(f), [60, 10]);
  assert.equal(f.session.controller.signal.aborted, true);
});

test("queued writes are serial and bounded; failure to merge a confirmed write cannot replay it", async () => {
  const f = fixture();
  const first = deferred<Response>();
  f.state.fetch = () => first.promise;
  f.advance(60000);
  await new Promise((resolve) => setImmediate(resolve));
  f.advance(60000);
  f.advance(60000);
  assert.equal(f.state.requests.length, 1);
  f.state.fetch = async () => new Response(null, { status: 204 });
  f.state.reconcile = async () => {
    throw new Error("merge failed");
  };
  first.resolve(new Response(null, { status: 204 }));
  await f.reporter.idle();
  assert.deepEqual(durations(f), [60, 60]);
  assert.equal(
    f.state.requests[0].body.playtimeAddList[0].endTime,
    f.state.requests[1].body.playtimeAddList[0].startTime
  );
  assert.ok(f.state.errors.includes("operation-in-progress"));
  assert.ok(f.state.errors.includes("merge-failed"));
  f.reporter.finish(f.session);
  await f.reporter.idle();
  assert.equal(f.state.requests.length, 2);
});

test("captured identity is immutable and changed user, environment, generation, connection or account blocks the write", async () => {
  for (const field of [
    "userId",
    "environment",
    "generation",
    "connectionId",
    "epicAccountId",
  ] as const) {
    const f = fixture();
    const token = deferred<string>();
    f.state.token = () => token.promise;
    f.advance(10000);
    f.reporter.finish(f.session);
    await new Promise((resolve) => setImmediate(resolve));
    if (field === "generation") f.state.active.auth.generation++;
    else if (field === "userId" || field === "environment")
      f.state.active.auth[field] += "B";
    else f.state.active.connection[field] += "B";
    token.resolve("private-token");
    await f.reporter.idle();
    assert.equal(f.state.requests.length, 0);
    assert.equal(f.state.confirmed, 0);
    assert.deepEqual(f.state.errors, ["stale-connection"]);
  }
  const f = fixture();
  f.target.auth.userId = "mutated";
  f.target.connection.epicAccountId = "mutated";
  f.target.artifactId = "mutated";
  assert.equal(f.session.target.auth.userId, "A");
  assert.equal(
    f.session.target.connection.epicAccountId,
    connection.epicAccountId
  );
  assert.equal(f.session.target.artifactId, "Artifact");
  f.reporter.invalidate();
});

test("disconnect aborts the old request; a new session has fresh identity and cannot inherit the old interval", async () => {
  const f = fixture();
  f.state.fetch = () => new Promise(() => {});
  f.advance(10000);
  f.reporter.finish(f.session);
  await new Promise((resolve) => setImmediate(resolve));
  f.reporter.invalidate();
  await f.reporter.idle();
  assert.equal(f.state.requests[0].options.signal!.aborted, true);
  assert.equal(f.state.confirmed, 0);
  f.state.active.auth.generation++;
  f.state.fetch = async () => new Response(null, { status: 204 });
  const next = f.reporter.begin("Namespace:Item", f.state.active);
  f.advance(10000, false);
  f.reporter.observe(next);
  f.reporter.finish(next);
  await f.reporter.idle();
  assert.deepEqual(durations(f), [10, 10]);
  assert.equal(f.state.confirmed, 1);
});

test("unconfirmed/offline time is not queued; shutdown reports only the last actual observation", async () => {
  const f = fixture();
  f.state.current = false;
  f.reporter.interruptAll();
  f.advance(60000);
  assert.equal(f.state.requests.length, 0);
  f.state.current = true;
  f.reporter.observe(f.session);
  f.advance(10000);
  f.advance(15000, false);
  await f.reporter.drain();
  assert.deepEqual(durations(f), [10]);
  assert.equal(
    f.state.requests[0].body.playtimeAddList[0].endTime,
    new Date(base + 70000).toISOString()
  );
  f.reporter.observe(f.session);
  assert.equal(f.state.requests.length, 1);
});
