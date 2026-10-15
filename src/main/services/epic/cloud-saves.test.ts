import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import ts from "typescript";
import * as protocol from "./cloud-save-protocol.js";
import * as files from "./cloud-save-files.js";
import { isRecord } from "./auth-protocol.js";
import type { Game } from "@types";

async function fixture(t: TestContext) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "epic-save-service-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const local = path.join(root, "local"),
    remote = path.join(root, "remote"),
    workspace = path.join(root, "workspace");
  await Promise.all([
    fsp.mkdir(local),
    fsp.mkdir(remote),
    fsp.mkdir(workspace),
  ]);
  const owner = {
    environment: "https://test.example",
    userId: "user",
    epicAccountId: "a".repeat(32),
  };
  const target = {
    owner,
    artifactId: "Artifact",
    platform: "Windows",
    auth: { ...owner, generation: 1 },
    connection: {
      connected: true,
      connectionId: "connection",
      epicAccountId: owner.epicAccountId,
    },
  };
  let game = {
    shop: "epic",
    objectId: "Namespace:Item",
    canonicalId: "canonical",
    epicInstallation: {
      owner,
      artifactId: "Artifact",
      platform: "Windows",
      savePath: local,
    },
  } as Game;
  const state = {
    manifest: null as string | null,
    current: true,
    running: false,
    partialUpload: false,
    beforeUpload: null as (() => Promise<void>) | null,
    uploads: 0,
    downloads: 0,
    commands: [] as string[][],
    events: [] as unknown[],
  };
  const installed = {
    app_name: "Artifact",
    save_path: local,
    installPath: root,
    executablePath: path.join(root, "Game.exe"),
  };
  await fsp.writeFile(
    path.join(workspace, "installed.json"),
    JSON.stringify({ Artifact: installed })
  );
  const runtime = {
    workspace: () => workspace,
    assertCurrent: (_target: unknown, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      if (!state.current)
        throw new protocol.EpicSaveFailure("operation-cancelled");
    },
    serializeWorkspace: async (
      _target: unknown,
      task: (directory: string) => Promise<unknown>
    ) => task(workspace),
    runRawUnlocked: async (
      _target: unknown,
      args: string[],
      options: { signal: AbortSignal }
    ) => {
      options.signal.throwIfAborted();
      state.commands.push(args);
      if (args[0] === "list-saves")
        return {
          stdout: `Save games:\n${state.manifest ? `- Example ("Artifact")\n + ${state.manifest}\n` : ""}`,
          stderr: "",
        };
      const savePath = args[args.indexOf("--save-path") + 1];
      assert.equal(args.includes("--upload-only"), false);
      assert.equal(args.includes("--download-only"), false);
      assert.equal(
        args.includes(
          args.includes("--force-upload") ? "--skip-download" : "--skip-upload"
        ),
        true
      );
      await fsp.writeFile(
        path.join(workspace, "installed.json"),
        JSON.stringify({ Artifact: { ...installed, save_path: savePath } })
      );
      const snapshotMetadata = {
        folder: local,
        include: ["*.sav"],
        exclude: [],
      };
      if (args.includes("--force-upload")) {
        await state.beforeUpload?.();
        state.uploads++;
        const snapshot = await files.inspectEpicSaveFiles(
          savePath,
          snapshotMetadata
        );
        await files.copyEpicSaveSnapshot(savePath, remote, snapshot);
        if (state.partialUpload)
          await fsp.writeFile(
            path.join(remote, "profile.sav"),
            "corrupt partial PUT"
          );
        state.manifest = `2026.10.14-10.00.${String(state.uploads).padStart(2, "0")}.manifest`;
        return {
          stdout: "",
          stderr: "[Core] INFO: Finished uploading savegame.",
        };
      }
      state.downloads++;
      const snapshot = await files.inspectEpicSaveFiles(
        remote,
        snapshotMetadata
      );
      await files.copyEpicSaveSnapshot(remote, savePath, snapshot);
      return {
        stdout: "",
        stderr: "[Core] INFO: Successfully completed savegame download.",
      };
    },
  };
  const modules: Record<string, unknown> = {
    "node:fs/promises": fsp,
    "node:path": path,
    "node:async_hooks": { AsyncLocalStorage },
    "node:timers/promises": { setTimeout: delay },
    electron: { app: { getPath: () => root } },
    "@main/level": {
      levelKeys: {
        game: (shop: string, objectId: string) => `${shop}:${objectId}`,
      },
      gamesSublevel: {
        get: async () => game,
        values: () => ({ all: async () => [game] }),
      },
    },
    "../game-record-updater": {
      updateGameRecord: async (_key: string, patch: (game: Game) => Game) => {
        game = { ...game, ...patch(game) };
        return game;
      },
    },
    "../game-running-state": { isGameRunning: () => state.running },
    "../wine": { Wine: { getPrefixUserProfile: () => null } },
    "./legendary-managed-runtime": {
      epicManagedErrorCode: () => "process-failed",
      epicOwnerMatches: (left: typeof owner, right: typeof owner) =>
        JSON.stringify(left) === JSON.stringify(right),
    },
    "./auth-protocol.js": { isRecord },
    "./installation": {
      readManagedJson: async (file: string) =>
        JSON.parse(await fsp.readFile(file, "utf8")),
      writeManagedJson: async (file: string, value: unknown) => {
        await fsp.writeFile(file, JSON.stringify(value));
      },
    },
    "./cloud-save-protocol.js": protocol,
    "./cloud-save-files.js": files,
    "./constants.js": {
      EPIC_SAVE_SYNC_TIMEOUT_MS: 1000,
      EPIC_SAVE_STABILITY_DELAY_MS: 1,
      EPIC_SAVE_STABILITY_ATTEMPTS: 3,
    },
  };
  const exported = {} as typeof import("./cloud-saves");
  const compiled = ts.transpileModule(
    fs.readFileSync(new URL("./cloud-saves.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  vm.runInNewContext(
    compiled,
    {
      exports: exported,
      require: (name: string) => {
        assert.ok(name in modules, `Unexpected import ${name}`);
        return modules[name];
      },
      process,
      setTimeout,
      clearTimeout,
      AbortController,
    },
    { filename: "cloud-saves.ts" }
  );
  const service = exported.configureEpicCloudSaves({
    runtime,
    installation: {
      capture: async () => ({
        ...target,
        game,
        owner,
        artifactIds: ["Artifact"],
      }),
      assertPlatform: () => {},
      readInstalled: async () => installed,
      metadata: async () => ({
        metadata: {
          customAttributes: {
            CloudSaveFolder: { value: local },
            CloudIncludeList: { value: "*.sav" },
          },
        },
      }),
    },
    emit: (event) => state.events.push(event),
  } as never);
  return {
    root,
    local,
    remote,
    workspace,
    state,
    service,
    exported,
    game: () => game,
  };
}

test("uploads a private stable copy, verifies readback and repeats without accumulating work", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "local save");
  await fsp.writeFile(path.join(f.local, "game.exe"), "unrelated");
  const result = await f.service.sync("Namespace:Item");
  assert.equal(result.status, "up-to-date");
  assert.equal(f.state.uploads, 1);
  assert.equal(f.state.downloads, 1);
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, false);
  assert.equal(
    f.game().epicInstallation?.saveAnchor?.remoteManifest,
    f.state.manifest
  );
  assert.equal(
    JSON.parse(
      await fsp.readFile(path.join(f.workspace, "installed.json"), "utf8")
    ).Artifact.save_path,
    f.local
  );
  assert.equal(
    await fsp.readFile(path.join(f.local, "game.exe"), "utf8"),
    "unrelated"
  );
  assert.equal((await f.service.sync("Namespace:Item")).status, "up-to-date");
  assert.equal(f.state.uploads, 1);
  const session = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  await f.service.markSessionStarted(session);
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, true);
  assert.equal((await f.service.afterClose(session))?.status, "up-to-date");
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, false);
  assert.equal(f.state.uploads, 1);
  assert.equal(f.state.downloads, 1);
});

test("first restore uses staging and preserves files excluded by Epic metadata", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.remote, "profile.sav"), "cloud save");
  await fsp.writeFile(path.join(f.local, "unrelated.bin"), "preserved");
  f.state.manifest = "2026.10.14-10.00.00.manifest";
  const result = await f.service.sync("Namespace:Item");
  assert.equal(result.status, "up-to-date");
  assert.equal(
    await fsp.readFile(path.join(f.local, "profile.sav"), "utf8"),
    "cloud save"
  );
  assert.equal(
    await fsp.readFile(path.join(f.local, "unrelated.bin"), "utf8"),
    "preserved"
  );
  assert.equal(
    f.state.commands
      .filter((args) => args.includes("--force-download"))
      .some((args) => args.includes(f.local)),
    false
  );
});

test("two initial copies require a choice and stale conflict choices cannot overwrite remote changes", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "local");
  const localModifiedAt = new Date("2026-10-14T09:00:00.000Z");
  await fsp.utimes(
    path.join(f.local, "profile.sav"),
    localModifiedAt,
    localModifiedAt
  );
  await fsp.writeFile(path.join(f.remote, "profile.sav"), "cloud");
  f.state.manifest = "2026.10.14-10.00.00.manifest";
  const conflict = await f.service.sync("Namespace:Item");
  assert.equal(conflict.status, "conflict");
  assert.equal(
    conflict.localModifiedAt,
    (await fsp.stat(path.join(f.local, "profile.sav"))).mtime.toISOString()
  );
  assert.equal(conflict.remoteModifiedAt, "2026-10-14T10:00:00.000Z");
  const old = f.state.manifest;
  f.state.manifest = "2026.10.14-11.00.00.manifest";
  assert.equal(
    (
      await f.service.resolveConflict({
        epicObjectId: "Namespace:Item",
        expectedRemoteManifest: old,
        choice: "local",
      })
    ).status,
    "conflict"
  );
  assert.equal(f.state.uploads, 0);
  const lastState = f.state.events.at(
    -1
  ) as import("@types").EpicCloudSaveState;
  assert.equal(lastState.remoteModifiedAt, "2026-10-14T11:00:00.000Z");
  assert.equal(
    (
      await f.service.resolveConflict({
        epicObjectId: "Namespace:Item",
        expectedRemoteManifest: f.state.manifest,
        choice: "local",
      })
    ).status,
    "up-to-date"
  );
  assert.equal(
    await fsp.readFile(path.join(f.remote, "profile.sav"), "utf8"),
    "local"
  );
});

test("exit zero with partial PUT never confirms upload and keeps pending local saves", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "complete local");
  f.state.partialUpload = true;
  const result = await f.service.sync("Namespace:Item");
  assert.equal(result.status, "pending-upload");
  assert.equal(result.error, "save-verification-failed");
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, true);
  assert.equal(f.game().epicInstallation?.saveAnchor, undefined);
  assert.equal(
    await fsp.readFile(path.join(f.local, "profile.sav"), "utf8"),
    "complete local"
  );
  f.state.partialUpload = false;
  assert.equal((await f.service.sync("Namespace:Item")).status, "conflict");
  assert.equal(
    (
      await f.service.resolveConflict({
        epicObjectId: "Namespace:Item",
        expectedRemoteManifest: f.state.manifest,
        choice: "local",
      })
    ).status,
    "up-to-date"
  );
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, false);
});

test("a session captures local-once without changing automatic settings or running Hydra concurrently", async (t) => {
  const f = await fixture(t);
  const session = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  await f.service.runLaunchGate("Namespace:Item", async () => {
    await f.service.beforeLaunch(session, true);
    assert.equal(session.automaticSync, false);
    assert.equal(f.exported.isEpicSaveFileOperationActive(), true);
  });
  assert.equal(f.game().epicInstallation?.automaticSaveSync, undefined);
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, true);
  assert.equal(
    (await f.service.getState("Namespace:Item")).automaticSync,
    true
  );
  assert.equal(f.state.commands.length, 0);
  assert.equal(await f.service.afterClose(session), undefined);
  const events: string[] = [];
  let release!: () => void;
  const first = f.exported.runWithHydraSaveGuard(async () => {
    events.push("first");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    events.push("first-end");
  });
  await new Promise((resolve) => setTimeout(resolve, 1));
  const second = f.exported.runWithHydraSaveGuard(async () => {
    events.push("second");
  });
  assert.deepEqual(events, ["first"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first", "first-end", "second"]);
});

test("reopening cancels post-close stabilization before commands and synchronizes through its own preflight", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "before");
  await f.service.sync("Namespace:Item");
  const session = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  await f.service.markSessionStarted(session);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "after close");
  const close = f.service.afterClose(session);
  let reopened = false;
  const launch = f.service.runLaunchGate("Namespace:Item", async () => {
    assert.equal(f.state.uploads, 1);
    const next = await f.service.capture(
      "Namespace:Item",
      new AbortController().signal
    );
    await f.service.beforeLaunch(next);
    reopened = true;
  });
  assert.equal(reopened, false);
  await Promise.all([close, launch]);
  assert.equal(reopened, true);
  assert.equal(
    await fsp.readFile(path.join(f.remote, "profile.sav"), "utf8"),
    "after close"
  );
  await f.service.invalidate();
  await assert.rejects(f.service.beforeLaunch(session), /operation-cancelled/);
});

test("reopening waits for a post-close cloud command that has already started", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "before");
  await f.service.sync("Namespace:Item");
  const session = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  await f.service.markSessionStarted(session);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "after close");
  let started!: () => void;
  let release!: () => void;
  const commandStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const heldUpload = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.state.beforeUpload = async () => {
    started();
    await heldUpload;
  };
  const close = f.service.afterClose(session);
  await commandStarted;
  let reopened = false;
  const launch = f.service.runLaunchGate("Namespace:Item", async () => {
    reopened = true;
  });
  await Promise.resolve();
  assert.equal(reopened, false);
  release();
  await Promise.all([close, launch]);
  assert.equal(reopened, true);
  assert.equal(f.state.uploads, 2);
  assert.equal(
    await fsp.readFile(path.join(f.remote, "profile.sav"), "utf8"),
    "after close"
  );
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, false);
});

test("early post-close inspection failures publish sanitized pending status and preserve local files", async (t) => {
  const f = await fixture(t);
  const save = path.join(f.local, "profile.sav");
  await fsp.writeFile(save, "local save");
  await f.service.sync("Namespace:Item");
  const session = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  await f.service.markSessionStarted(session);
  const lstat = fsp.lstat;
  t.mock.method(fsp, "lstat", async (filename: string) => {
    if (filename === f.local)
      throw Object.assign(new Error("private native failure detail"), {
        code: "EACCES",
      });
    return lstat(filename);
  });
  const state = await f.service.afterClose(session);
  assert.equal(state?.status, "pending-upload");
  assert.equal(state?.error, "save-sync-failed");
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, true);
  assert.equal(
    (await f.service.getState("Namespace:Item")).status,
    "pending-upload"
  );
  assert.equal(
    JSON.stringify(f.state.events).includes("private native failure detail"),
    false
  );
  assert.equal(await fsp.readFile(save, "utf8"), "local save");
});

test("invalidated post-close inspection publishes nothing to the replacement context", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "local save");
  await f.service.sync("Namespace:Item");
  const session = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  await f.service.markSessionStarted(session);
  const events = f.state.events.length;
  const close = f.service.afterClose(session);
  const invalidated = f.service.invalidate();
  await assert.rejects(close, /operation-cancelled/);
  await invalidated;
  assert.equal(f.state.events.length, events);
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, true);
  assert.equal(
    await fsp.readFile(path.join(f.local, "profile.sav"), "utf8"),
    "local save"
  );
});

test("a launched session blocks manual restore before the watcher first detects its process", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.remote, "profile.sav"), "cloud save");
  f.state.manifest = "2026.10.14-10.00.00.manifest";
  const session = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  await f.service.markSessionStarted(session);
  assert.equal(f.state.running, false);
  const blocked = await f.service.sync("Namespace:Item");
  assert.equal(blocked.error, "game-running");
  assert.equal(f.state.downloads, 0);
  f.service.endSession(session);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "session save");
  // Pending local state is preserved, so a remote copy still requires a choice.
  assert.equal((await f.service.sync("Namespace:Item")).status, "conflict");
  assert.equal(f.state.downloads, 0);
});

test("opt-out, unsupported and offline sessions reject invalidated scope after launch preflight", async (t) => {
  for (const policy of ["opt-out", "unsupported", "offline"] as const) {
    const f = await fixture(t);
    const session = await f.service.capture(
      "Namespace:Item",
      new AbortController().signal
    );
    if (policy === "opt-out") session.automaticSync = false;
    else if (policy === "unsupported") session.metadata.folder = null;
    else await f.service.beforeLaunch(session, true);
    // A preflight can yield long enough for logout, disconnect or an account change.
    f.state.current = false;
    await assert.rejects(
      f.service.markSessionStarted(session),
      /operation-cancelled/
    );
    assert.throws(
      () => f.service.assertSessionCurrent(session),
      /operation-cancelled/
    );
    assert.equal(f.state.commands.length, 0);
  }
});

test("manual Epic work cannot queue behind a launch that still needs its own prelaunch sync", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "local");
  const session = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  let startManual!: () => void;
  // Register outside the launch's async context, as a separate IPC would run.
  const manual = new Promise<void>((resolve) => {
    startManual = resolve;
  }).then(() => f.service.sync("Namespace:Item"));
  await f.service.runLaunchGate("Namespace:Item", async () => {
    startManual();
    await assert.rejects(manual, /save-operation-active/);
    await f.service.beforeLaunch(session);
  });
  assert.equal(f.state.uploads, 1);
  assert.equal(
    (await f.service.getState("Namespace:Item")).status,
    "up-to-date"
  );
});

test("all Hydra v2 sync entry points take the provider gate before the per-game gate", async (t) => {
  const f = await fixture(t);
  const events: string[] = [];
  let releaseEpic!: () => void;
  const epic = f.exported.runWithHydraSaveGuard(async () => {
    events.push("epic-start");
    await new Promise<void>((resolve) => {
      releaseEpic = resolve;
    });
    events.push("epic-end");
  });
  await new Promise((resolve) => setTimeout(resolve, 1));
  const compiled = ts.transpileModule(
    fs.readFileSync(
      new URL("../cloud-save/sync-game-cloud-save.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const exported: {
    run?: (
      objectId: string,
      shop: string,
      key: string,
      run: () => Promise<unknown>
    ) => Promise<unknown>;
  } = {};
  vm.runInNewContext(compiled + "\nexports.run = runCloudSaveOperation;", {
    exports: exported,
    require: (name: string) => {
      if (name === "../epic/cloud-saves") return f.exported;
      if (name === "./operation-gate")
        return {
          cloudSaveOperationGate: {
            runSync: async (
              _key: string,
              _operation: string,
              task: () => Promise<unknown>
            ) => {
              events.push("hydra-game-gate");
              return task();
            },
          },
        };
      if (name === "./pending-deletion")
        return { assertCloudSaveDeletionNotPending: async () => {} };
      return {};
    },
  });
  const hydra = exported.run!("game", "steam", "manual", async () => {
    events.push("hydra-transfer");
    return {};
  });
  assert.deepEqual(events, ["epic-start"]);
  releaseEpic();
  await Promise.all([epic, hydra]);
  assert.deepEqual(events, [
    "epic-start",
    "epic-end",
    "hydra-game-gate",
    "hydra-transfer",
  ]);
});
