import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
import { test } from "node:test";
import * as contracts from "./managed-ipc-contract.js";

function fixture(overrides: Record<string, unknown> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();
  const services = Object.fromEntries(
    [
      "getEpicConnection",
      "getGameLinuxCompatibility",
      "startEpicAuth",
      "cancelEpicAuth",
      "disconnectEpic",
      "startEpicSync",
      "getEpicSyncState",
      "cancelEpicSync",
      "syncEpicGameOnGamePage",
      "getEpicGameInstallOptions",
      "startEpicGameDownload",
      "getEpicCloudSaveState",
      "setEpicCloudSaveSettings",
      "syncEpicCloudSaves",
      "resolveEpicCloudSaveConflict",
    ].map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push({ name, args });
        return { ok: true };
      },
    ])
  );
  const modules: Record<string, unknown> = {
    "../../services/epic": { ...services, ...overrides },
    "../register-event": {
      registerEvent: (
        name: string,
        handler: (event: unknown, ...args: unknown[]) => unknown
      ) => handlers.set(name, handler),
    },
    "./assert-trusted-sender": {
      assertTrustedEpicSender: (
        event: { trusted: boolean; bigPicture?: boolean },
        allowBigPicture?: boolean
      ) => {
        if (!event.trusted || (event.bigPicture && !allowBigPicture))
          throw new Error("epic-ipc-untrusted");
      },
    },
    "./managed-ipc-contract": contracts,
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }
    ).outputText,
    {
      exports: {},
      AbortController,
      require: (name: string) =>
        modules[name] ?? assert.fail(`Unexpected dependency ${name}`),
    }
  );
  return { calls, handlers };
}

test("managed operations reject an untrusted sender before any process or save action", () => {
  const f = fixture();
  for (const name of [
    "getEpicGameInstallOptions",
    "cancelEpicGameInstallOptions",
    "getGameLinuxCompatibility",
    "startEpicGameDownload",
    "getEpicCloudSaveState",
    "setEpicCloudSaveSettings",
    "syncEpicCloudSaves",
    "resolveEpicCloudSaveConflict",
  ]) {
    assert.throws(
      () => f.handlers.get(name)!({ trusted: false }, "namespace:item"),
      /epic-ipc-untrusted/
    );
  }
  assert.equal(f.calls.length, 0);
});

test("preview cancellation belongs to its sender and releases listeners after completion", async () => {
  let signal: AbortSignal | undefined;
  const f = fixture({
    getEpicGameInstallOptions: (_id: string, current: AbortSignal) => {
      signal = current;
      return new Promise((resolve) => {
        current.addEventListener(
          "abort",
          () =>
            resolve({
              options: [],
              error: "operation-cancelled",
            }),
          { once: true }
        );
      });
    },
  });
  const sender = new EventEmitter();
  const event = { trusted: true, sender };
  const requestId = "preview-1";
  const pending = f.handlers.get("getEpicGameInstallOptions")!(
    event,
    "namespace:item",
    requestId
  );
  await Promise.resolve();
  assert.equal(sender.listenerCount("destroyed"), 1);
  f.handlers.get("cancelEpicGameInstallOptions")!(
    { trusted: true, sender: new EventEmitter() },
    requestId
  );
  assert.equal(signal?.aborted, false);
  f.handlers.get("cancelEpicGameInstallOptions")!(event, requestId);
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(sender.listenerCount("destroyed"), 0);
});

test("destroying a renderer cancels all its pending previews", async () => {
  const signals: AbortSignal[] = [];
  const f = fixture({
    getEpicGameInstallOptions: (_id: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({ options: [] }), {
          once: true,
        });
      });
    },
  });
  const sender = new EventEmitter();
  const event = { trusted: true, sender };
  const pending = ["first", "second"].map((id) =>
    f.handlers.get("getEpicGameInstallOptions")!(event, "namespace:item", id)
  );
  await Promise.resolve();
  sender.emit("destroyed");
  await Promise.all(pending);
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(sender.listenerCount("destroyed"), 0);
});

test("desktop and Big Picture pass only parsed Epic inputs to managed services", () => {
  const f = fixture();
  const event = { trusted: true, bigPicture: true };
  const payload = {
    epicObjectId: "namespace:item",
    connectionId: "abcdefgh",
    artifactId: "Artifact",
    platform: "Windows",
    downloadPath: os.tmpdir(),
  };
  f.handlers.get("getEpicConnection")!(event);
  f.handlers.get("getEpicGameInstallOptions")!(event, payload.epicObjectId);
  f.handlers.get("startEpicGameDownload")!(event, payload);
  f.handlers.get("getEpicCloudSaveState")!(event, payload.epicObjectId);
  f.handlers.get("setEpicCloudSaveSettings")!(event, payload.epicObjectId, {
    automaticSync: true,
  });
  f.handlers.get("syncEpicCloudSaves")!(event, payload.epicObjectId);
  f.handlers.get("resolveEpicCloudSaveConflict")!(event, {
    epicObjectId: payload.epicObjectId,
    expectedRemoteManifest: null,
    expectedRemoteModifiedAt: null,
    choice: "local",
  });
  assert.equal(f.calls.length, 7);
  assert.deepEqual(f.calls[2], {
    name: "startEpicGameDownload",
    args: [payload],
  });
  assert.throws(() =>
    f.handlers.get("startEpicGameDownload")!(event, {
      ...payload,
      command: "install",
    })
  );
  assert.throws(() =>
    f.handlers.get("syncEpicCloudSaves")!(event, "../steam-game")
  );
  assert.equal(f.calls.length, 7);
  f.handlers.get("getGameLinuxCompatibility")!(
    event,
    "epic",
    payload.epicObjectId
  );
  assert.deepEqual(f.calls[7], {
    name: "getGameLinuxCompatibility",
    args: ["epic", payload.epicObjectId],
  });
  assert.throws(() =>
    f.handlers.get("getGameLinuxCompatibility")!(event, "epic", "../escape")
  );
  assert.equal(
    f.handlers.get("getGameLinuxCompatibility")!(event, "steam", "123"),
    null
  );
  assert.equal(f.calls.length, 8);
});
