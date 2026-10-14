import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";
import * as contracts from "./managed-ipc-contract.js";

function fixture() {
  const calls: { name: string; args: unknown[] }[] = [];
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();
  const services = Object.fromEntries(
    [
      "getEpicConnection",
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
    "../../services/epic": services,
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
});
