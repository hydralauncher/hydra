import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { IncomingMessage } from "node:http";
import type { ClientOptions, RawData } from "ws";
import {
  fullJitterDelay,
  parseRealtimeEnvelope,
  parseRetryAfter,
  RealtimeWebSocketClient,
  type RealtimeSocket,
} from "./websocket-client.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeSocket extends EventEmitter implements RealtimeSocket {
  readyState = 0;
  closeCalls = 0;
  terminateCalls = 0;

  ping() {
    return undefined;
  }

  close() {
    this.closeCalls++;
    this.emit("close", 1_000, Buffer.alloc(0));
  }

  terminate() {
    this.terminateCalls++;
    this.emit("close", 1_006, Buffer.alloc(0));
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  message(value: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(value)) as RawData);
  }

  serverClose(code: number, reason = "") {
    this.emit("close", code, Buffer.from(reason));
  }

  unexpectedResponse(response: IncomingMessage) {
    this.emit("unexpected-response", {}, response);
  }
}

const makeHarness = () => {
  const sockets: FakeSocket[] = [];
  const socketUrls: string[] = [];
  const sleeps: Array<{ ms: number; resolve: () => void }> = [];
  const events: string[] = [];
  let mints = 0;
  let resyncs = 0;

  const client = new RealtimeWebSocketClient({
    fallbackUrl: "wss://fallback.example.test",
    mintToken: async () => {
      mints++;
      return {
        token: "token",
        url: "wss://canonical.example.test/socket",
        expiresIn: 300,
      };
    },
    onEvent: (event) => {
      events.push(event.eventId);
    },
    onReconnect: () => resyncs++,
    createSocket: (url: string, _options: ClientOptions) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      socketUrls.push(url);
      return socket;
    },
    random: () => 0,
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        sleeps.push({ ms, resolve });
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });

  return {
    client,
    sockets,
    socketUrls,
    sleeps,
    events,
    getMints: () => mints,
    getResyncs: () => resyncs,
  };
};

describe("realtime WebSocket helpers", () => {
  it("uses full jitter bounded by exponential cap", () => {
    assert.equal(
      fullJitterDelay(1, () => 0),
      0
    );
    assert.equal(
      fullJitterDelay(1, () => 0.999),
      999
    );
    assert.equal(
      fullJitterDelay(99, () => 0.999),
      29_970
    );
  });

  it("validates wire messages", () => {
    assert.deepEqual(
      parseRealtimeEnvelope(
        JSON.stringify({
          v: 1,
          eventId: "evt-1",
          event: "notification",
          payload: { invalidate: "notifications" },
          publishedAt: 1,
        })
      ),
      {
        v: 1,
        eventId: "evt-1",
        event: "notification",
        payload: { invalidate: "notifications" },
        publishedAt: 1,
      }
    );
    assert.equal(parseRealtimeEnvelope('{"v":2}'), null);
    assert.equal(parseRealtimeEnvelope("not json"), null);

    assert.notEqual(
      parseRealtimeEnvelope(
        JSON.stringify({
          v: 1,
          eventId: "friend-request-invalidation",
          event: "friendRequest",
          payload: { invalidate: "friendRequests", senderId: "sender-1" },
          publishedAt: Date.now(),
        })
      ),
      null
    );
    assert.notEqual(
      parseRealtimeEnvelope(
        JSON.stringify({
          v: 1,
          eventId: "presence",
          event: "friendPresence",
          payload: { friendId: "friend-1", isOnline: true, version: 1 },
          publishedAt: Date.now(),
        })
      ),
      null
    );
  });

  it("rejects unknown events and malformed event payloads", () => {
    const invalidMessages = [
      { event: "unknown", payload: {} },
      { event: "friendRequest", payload: { invalidate: "notifications" } },
      {
        event: "friendGameSession",
        payload: { objectId: "1", shop: "steam" },
      },
      {
        event: "friendPresence",
        payload: { friendId: "1", isOnline: "yes", version: 1 },
      },
      {
        event: "friendPresence",
        payload: { friendId: "1", isOnline: true, version: 0 },
      },
      { event: "notification", payload: { invalidate: "friendRequests" } },
    ];

    for (const [index, message] of invalidMessages.entries()) {
      assert.equal(
        parseRealtimeEnvelope(
          JSON.stringify({
            v: 1,
            eventId: `invalid-${index}`,
            publishedAt: Date.now(),
            ...message,
          })
        ),
        null
      );
    }
  });

  it("parses numeric and HTTP-date retry hints", () => {
    assert.equal(parseRetryAfter("12", 1_000), 12_000);
    assert.equal(
      parseRetryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 1_000),
      9_000
    );
  });
});

describe("RealtimeWebSocketClient", () => {
  it("keeps one loop and closes a superseded socket", async () => {
    const harness = makeHarness();
    harness.client.connect();
    await tick();
    assert.equal(harness.sockets.length, 1);
    assert.equal(harness.socketUrls[0], "wss://canonical.example.test/socket");

    harness.client.connect();
    await tick();
    assert.equal(harness.sockets[0].terminateCalls, 1);
    assert.equal(harness.sockets.length, 2);
    harness.client.close();
  });

  it("deduplicates messages, reuses token, reconnects, and resyncs", async () => {
    const harness = makeHarness();
    harness.client.connect();
    await tick();
    harness.sockets[0].open();
    harness.sockets[0].message({
      v: 1,
      eventId: "evt-1",
      event: "notification",
      payload: { invalidate: "notifications" },
      publishedAt: Date.now(),
    });
    harness.sockets[0].message({
      v: 1,
      eventId: "evt-1",
      event: "notification",
      payload: { invalidate: "notifications" },
      publishedAt: Date.now(),
    });
    harness.sockets[0].message({ v: 1 });
    await tick();
    assert.deepEqual(harness.events, ["evt-1"]);

    harness.sockets[0].serverClose(1_006);
    await tick();
    assert.equal(harness.sleeps[0].ms, 1_000);
    harness.sleeps[0].resolve();
    await tick();
    assert.equal(harness.getMints(), 1);
    harness.sockets[1].open();
    assert.equal(harness.getResyncs(), 1);
    harness.client.close();
  });

  it("does not open or cache a mint completed after logout", async () => {
    const mintResolvers: Array<
      (token: { token: string; url: string; expiresIn: number }) => void
    > = [];
    let mints = 0;
    const sockets: FakeSocket[] = [];
    const client = new RealtimeWebSocketClient({
      mintToken: () => {
        mints++;
        return new Promise((resolve) => {
          mintResolvers.push(resolve);
        });
      },
      onEvent: () => undefined,
      onReconnect: () => undefined,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    client.connect();
    await tick();
    client.close();
    client.connect();
    await tick();
    assert.equal(mints, 2);

    mintResolvers[0]({
      token: "stale",
      url: "wss://stale.example.test",
      expiresIn: 300,
    });
    await tick();
    assert.equal(sockets.length, 0);
    client.close();
  });

  it("aborts an in-flight mint and randomizes forced reconnect", async () => {
    const mintSignals: AbortSignal[] = [];
    const mintResolvers: Array<
      (token: { token: string; url: string; expiresIn: number }) => void
    > = [];
    const sleeps: Array<{ ms: number; resolve: () => void }> = [];
    const sockets: FakeSocket[] = [];
    const client = new RealtimeWebSocketClient({
      mintToken: (signal) => {
        mintSignals.push(signal);
        return new Promise((resolve) => mintResolvers.push(resolve));
      },
      onEvent: () => undefined,
      onReconnect: () => undefined,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      random: () => 0,
      sleep: (ms, signal) =>
        new Promise<void>((resolve) => {
          sleeps.push({ ms, resolve });
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    client.connect();
    await tick();
    client.reconnectNow();
    assert.equal(mintSignals[0].aborted, true);
    await tick();
    assert.equal(sleeps[0].ms, 250);
    sleeps[0].resolve();
    await tick();
    assert.equal(mintSignals.length, 2);

    mintResolvers[0]({
      token: "stale",
      url: "wss://stale.example.test",
      expiresIn: 300,
    });
    await tick();
    assert.equal(sockets.length, 0);
    client.close();
  });

  it("ignores stale socket messages after close", async () => {
    const harness = makeHarness();
    harness.client.connect();
    await tick();
    const socket = harness.sockets[0];
    socket.open();
    harness.client.close();
    socket.message({
      v: 1,
      eventId: "stale",
      event: "notification",
      payload: { invalidate: "notifications" },
      publishedAt: Date.now(),
    });
    await tick();
    assert.deepEqual(harness.events, []);
  });

  it("does not dedupe failed handling and requests resync", async () => {
    const socket = new FakeSocket();
    let attempts = 0;
    let resyncs = 0;
    const client = new RealtimeWebSocketClient({
      mintToken: async () => ({
        token: "token",
        url: "wss://canonical.example.test",
        expiresIn: 300,
      }),
      onEvent: async () => {
        attempts++;
        if (attempts === 1) throw new Error("handler failed");
      },
      onReconnect: () => undefined,
      onEventFailure: () => resyncs++,
      createSocket: () => socket,
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });
    const message = {
      v: 1,
      eventId: "retryable",
      event: "notification",
      payload: { invalidate: "notifications" },
      publishedAt: Date.now(),
    };

    client.connect();
    await tick();
    socket.open();
    socket.message(message);
    await tick();
    assert.equal(resyncs, 1);
    socket.message(message);
    await tick();
    socket.message(message);
    await tick();
    assert.equal(attempts, 2);
    client.close();
  });

  it("rejects stale friend presence versions and clears versions on close", async () => {
    const harness = makeHarness();
    harness.client.connect();
    await tick();
    harness.sockets[0].open();

    for (const [eventId, version] of [
      ["presence-2", 2],
      ["presence-1", 1],
      ["presence-3", 3],
    ] as const) {
      harness.sockets[0].message({
        v: 1,
        eventId,
        event: "friendPresence",
        payload: { friendId: "friend-1", isOnline: true, version },
        publishedAt: Date.now(),
      });
    }
    await tick();
    assert.deepEqual(harness.events, ["presence-2", "presence-3"]);

    harness.client.close();
    harness.client.connect();
    await tick();
    harness.sockets[1].open();
    harness.sockets[1].message({
      v: 1,
      eventId: "new-session-presence-1",
      event: "friendPresence",
      payload: { friendId: "friend-1", isOnline: false, version: 1 },
      publishedAt: Date.now(),
    });
    await tick();
    assert.deepEqual(harness.events, [
      "presence-2",
      "presence-3",
      "new-session-presence-1",
    ]);
    harness.client.close();
  });

  it("aborts an in-flight event handler before its side effect", async () => {
    const socket = new FakeSocket();
    let handlerSignal: AbortSignal | undefined;
    let releaseHandler: (() => void) | undefined;
    let sideEffects = 0;
    const client = new RealtimeWebSocketClient({
      mintToken: async () => ({
        token: "token",
        url: "wss://canonical.example.test",
        expiresIn: 300,
      }),
      onEvent: async (_event, signal) => {
        handlerSignal = signal;
        await new Promise<void>((resolve) => {
          releaseHandler = resolve;
        });
        if (!signal.aborted) sideEffects++;
      },
      onReconnect: () => undefined,
      createSocket: () => socket,
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    client.connect();
    await tick();
    socket.open();
    socket.message({
      v: 1,
      eventId: "abort-handler",
      event: "notification",
      payload: { invalidate: "notifications" },
      publishedAt: Date.now(),
    });
    await tick();
    client.close();
    assert.equal(handlerSignal?.aborted, true);
    releaseHandler?.();
    await tick();
    assert.equal(sideEffects, 0);
  });

  it("delays server drains and randomizes resume reconnects", async () => {
    const drain = makeHarness();
    drain.client.connect();
    await tick();
    drain.sockets[0].open();
    drain.sockets[0].serverClose(
      1_012,
      JSON.stringify({ retryAfterSeconds: 5 })
    );
    await tick();
    assert.equal(drain.sleeps[0].ms, 5_250);
    drain.client.close();

    const resume = makeHarness();
    resume.client.connect();
    await tick();
    resume.sockets[0].open();
    resume.client.reconnectNow();
    await tick();
    assert.equal(resume.sleeps[0].ms, 250);
    resume.client.close();
  });
});
