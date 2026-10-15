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
import { EpicCloudSaveSource } from "./cloud-save-source.js";
import * as files from "./cloud-save-files.js";
import { isRecord } from "./auth-protocol.js";
import * as linuxPaths from "./cloud-save-linux-path.js";
import { resolveWinePrefixPath } from "../wine-prefix.js";
import { queueEpicOperation } from "./operation-queue.js";
import { deferred } from "./store-test-helpers.js";
import type { Game } from "@types";

const TEST_SAVE_SYNC_TIMEOUT_MS = 10_000;

async function fixture(t: TestContext, options: { linux?: boolean } = {}) {
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
  const prefix = path.join(root, "prefix");
  const profile = path.join(prefix, "drive_c", "users", "steamuser");
  await fsp.mkdir(path.join(profile, "AppData", "Local"), { recursive: true });
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
    lastModified: "2026-10-14T10:00:00.000Z",
    otherManifests: [] as protocol.EpicRemoteSaveManifest[],
    current: true,
    running: false,
    partialUpload: false,
    offline: false,
    beforeUpload: null as (() => Promise<void>) | null,
    beforeDownload: null as (() => Promise<void>) | null,
    uploads: 0,
    downloads: 0,
    commands: [] as string[][],
    events: [] as unknown[],
    folder: local as string | null,
    prefixPath: prefix,
    prefixReady: true,
    prefixGeneration: "generation-a" as string | null,
    prefixResolutions: 0,
    prefixBusy: false,
    leaseId: "own-launch-lease",
    mutationLeases: [] as Array<string | undefined>,
    workspaceTail: undefined as Promise<unknown> | undefined,
    workspaceSignals: [] as Array<AbortSignal | undefined>,
    workspaceExecutions: 0,
    onWorkspaceQueued: null as (() => void) | null,
    beforeMetadata: null as (() => Promise<void>) | null,
    captureSignals: [] as AbortSignal[],
  };
  const installed: {
    app_name: string;
    save_path: string | null;
    installPath: string;
    executablePath: string;
  } = {
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
      task: (directory: string) => Promise<unknown>,
      signal?: AbortSignal
    ) => {
      const { queued, result } = queueEpicOperation(
        state.workspaceTail,
        () => {
          state.workspaceExecutions++;
          return task(workspace);
        },
        signal
      );
      state.workspaceTail = queued;
      state.workspaceSignals.push(signal);
      state.onWorkspaceQueued?.();
      return result;
    },
    runRawUnlocked: async (
      _target: unknown,
      args: string[],
      options: { signal: AbortSignal }
    ) => {
      options.signal.throwIfAborted();
      state.commands.push(args);
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
        state.lastModified = `2026-10-15T10:00:${String(state.uploads).padStart(2, "0")}.000Z`;
        return {
          stdout: "",
          stderr: "[Core] INFO: Finished uploading savegame.",
        };
      }
      state.downloads++;
      await state.beforeDownload?.();
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
    "../logger": { logger: { warn: () => {} } },
    "../wine": {
      Wine: {
        getPrefixUserProfile: () =>
          state.prefixReady
            ? { path: profile, windowsPath: "C:/users/steamuser" }
            : null,
        isPrefixReadyForRestore: () => state.prefixReady,
        resolvePrefixPath: (value: string | null) =>
          resolveWinePrefixPath(value, root),
      },
    },
    "./linux-runtime": {
      resolveEpicLinuxPrefixPath: async (game: Game) => {
        state.prefixResolutions++;
        return game.winePrefixPath ?? state.prefixPath;
      },
      getEpicLinuxPrefixGeneration: async () =>
        state.prefixReady ? state.prefixGeneration : null,
      withEpicLinuxPrefixMutation: async (
        _prefix: string,
        task: () => Promise<unknown>,
        lease?: string
      ) => {
        state.mutationLeases.push(lease);
        if (state.prefixBusy && lease !== state.leaseId)
          throw new protocol.EpicSaveFailure("compatibility-prefix-busy");
        return task();
      },
    },
    "./cloud-save-linux-path.js": linuxPaths,
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
      EPIC_SAVE_SYNC_TIMEOUT_MS: TEST_SAVE_SYNC_TIMEOUT_MS,
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
      process: { ...process, platform: options.linux ? "linux" : "win32" },
      setTimeout,
      clearTimeout,
      AbortController,
    },
    { filename: "cloud-saves.ts" }
  );
  const service = exported.configureEpicCloudSaves({
    runtime,
    source: new EpicCloudSaveSource(
      { token: async () => "test-token" },
      async (_url, options) => {
        options?.signal?.throwIfAborted();
        state.commands.push(["remote-manifests"]);
        return Response.json({
          files: Object.fromEntries(
            [
              ...state.otherManifests,
              ...(state.manifest
                ? [{ name: state.manifest, lastModified: state.lastModified }]
                : []),
            ].map((manifest) => [
              `savesync/${owner.epicAccountId}/Artifact/manifests/${manifest.name}`,
              { lastModified: manifest.lastModified },
            ])
          ),
        });
      }
    ),
    installation: {
      capture: async (_objectId: string, signal: AbortSignal) => {
        state.captureSignals.push(signal);
        if (state.offline) throw new Error("offline");
        return {
          ...target,
          game,
          owner,
          artifactIds: ["Artifact"],
        };
      },
      captureLocal: async () => ({
        ...target,
        game,
        owner,
        artifactIds: ["Artifact"],
      }),
      assertPlatform: () => {},
      readInstalled: async () => ({
        ...installed,
        ...JSON.parse(
          await fsp.readFile(path.join(workspace, "installed.json"), "utf8")
        ).Artifact,
      }),
      metadata: async () => {
        await state.beforeMetadata?.();
        return {
          metadata: {
            customAttributes: {
              CloudSaveFolder: { value: state.folder },
              CloudIncludeList: { value: "*.sav" },
            },
          },
        };
      },
    },
    emit: (event) => state.events.push(event),
  } as never);
  return {
    root,
    local,
    remote,
    workspace,
    prefix,
    profile,
    installed,
    state,
    service,
    exported,
    game: () => game,
  };
}

test("persists the real path before the first transfer can be interrupted", async (t) => {
  const f = await fixture(t);
  delete f.game().epicInstallation!.savePath;
  await fsp.writeFile(path.join(f.local, "profile.sav"), "local save");
  f.state.beforeUpload = async () => {
    assert.equal(f.game().epicInstallation?.savePath, f.local);
  };
  assert.equal((await f.service.sync("Namespace:Item")).status, "up-to-date");
  assert.equal(f.state.uploads, 1);
});

test("recovers interrupted transfer paths before capture, including legacy transfers", async (t) => {
  for (const persisted of [true, false]) {
    const f = await fixture(t);
    if (!persisted) delete f.game().epicInstallation!.savePath;
    const staging = path.join(
      f.workspace,
      "save-transfer-interrupted",
      "staging"
    );
    const installedFile = path.join(f.workspace, "installed.json");
    const installed = JSON.parse(await fsp.readFile(installedFile, "utf8"));
    installed.Artifact.save_path = staging;
    await fsp.writeFile(installedFile, JSON.stringify(installed));
    const session = await f.service.capture(
      "Namespace:Item",
      new AbortController().signal
    );
    assert.equal(session.savePath, f.local);
    assert.equal(session.installed.save_path, f.local);
    assert.equal(f.game().epicInstallation?.savePath, f.local);
    assert.equal(
      JSON.parse(await fsp.readFile(installedFile, "utf8")).Artifact.save_path,
      f.local
    );
    assert.equal(f.state.commands.length, 0);
  }
});

test("Linux interrupted recovery preserves paths that still need prefix validation or an explicit choice", async (t) => {
  for (const prefixReady of [false, true]) {
    const f = await fixture(t, { linux: true });
    f.state.folder = "{appdata}/Example";
    f.state.prefixReady = prefixReady;
    if (!prefixReady) f.game().epicInstallation!.savePathSource = "custom";
    const installedFile = path.join(f.workspace, "installed.json");
    const installed = JSON.parse(await fsp.readFile(installedFile, "utf8"));
    installed.Artifact.save_path = path.join(
      f.workspace,
      "save-transfer-interrupted",
      "staging"
    );
    await fsp.writeFile(installedFile, JSON.stringify(installed));
    const session = await f.service.capture(
      "Namespace:Item",
      new AbortController().signal
    );
    assert.equal(session.savePath, null);
    assert.equal(f.game().epicInstallation?.savePath, f.local);
    assert.equal(
      f.game().epicInstallation?.savePathSource,
      prefixReady ? undefined : "custom"
    );
    assert.equal(session.installed.save_path, null);
    assert.equal(
      JSON.parse(await fsp.readFile(installedFile, "utf8")).Artifact.save_path,
      null
    );
    assert.equal(f.state.commands.length, 0);
  }
});

test("local recovery settings remain writable while Epic is offline", async (t) => {
  const f = await fixture(t);
  f.state.offline = true;
  const savePath = path.join(f.root, "replacement");
  await f.service.setSettings("Namespace:Item", {
    automaticSync: false,
    savePath,
  });
  assert.equal(f.game().epicInstallation?.automaticSaveSync, false);
  assert.equal(f.game().epicInstallation?.savePath, savePath);
  assert.equal(f.state.commands.length, 0);
});

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
  const oldModifiedAt = f.state.lastModified;
  f.state.manifest = "2026.10.14-11.00.00.manifest";
  f.state.lastModified = "2026-10-14T11:00:00.000Z";
  assert.equal(
    (
      await f.service.resolveConflict({
        epicObjectId: "Namespace:Item",
        expectedRemoteManifest: old,
        expectedRemoteModifiedAt: oldModifiedAt,
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
        expectedRemoteModifiedAt: f.state.lastModified,
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
        expectedRemoteModifiedAt: f.state.lastModified,
        choice: "local",
      })
    ).status,
    "up-to-date"
  );
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, false);
});

test("identical initial copies commit an anchor instead of conflicting", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "shared with EGS");
  await fsp.writeFile(path.join(f.remote, "profile.sav"), "shared with EGS");
  f.state.manifest = "2026.10.14-10.00.00.manifest";
  const result = await f.service.sync("Namespace:Item");
  assert.equal(result.status, "up-to-date");
  assert.equal(f.state.uploads, 0);
  assert.equal(
    f.game().epicInstallation?.saveAnchor?.remoteManifest,
    f.state.manifest
  );
  assert.equal(
    await fsp.readFile(path.join(f.local, "profile.sav"), "utf8"),
    "shared with EGS"
  );
  assert.deepEqual(
    (await fsp.readdir(f.workspace)).filter((name) =>
      name.startsWith("save-transfer-")
    ),
    []
  );
});

test("an upload that failed verification resolves on the next sync without a conflict", async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "local save");
  let failVerification = true;
  f.state.beforeDownload = async () => {
    if (!failVerification) return;
    failVerification = false;
    throw new Error("network");
  };
  assert.equal(
    (await f.service.sync("Namespace:Item")).status,
    "pending-upload"
  );
  assert.equal(f.state.uploads, 1);
  const result = await f.service.sync("Namespace:Item");
  assert.equal(result.status, "up-to-date");
  assert.equal(f.state.uploads, 1);
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, false);
  assert.equal(
    f.game().epicInstallation?.saveAnchor?.remoteManifest,
    f.state.manifest
  );
});

test("a later upload of an older backup downloads or conflicts instead of silently uploading", async (t) => {
  for (const edited of [false, true]) {
    const f = await fixture(t);
    f.state.manifest = "2026.10.14-12.00.00.manifest";
    f.state.lastModified = "2026-10-14T12:00:00.000Z";
    await fsp.writeFile(
      path.join(f.remote, "profile.sav"),
      "initial cloud save"
    );
    assert.equal((await f.service.sync("Namespace:Item")).status, "up-to-date");
    f.state.otherManifests.push({
      name: f.state.manifest,
      lastModified: f.state.lastModified,
    });
    f.state.manifest = "2026.10.13-12.00.00.manifest";
    f.state.lastModified = "2026-10-15T12:00:00.000Z";
    await fsp.writeFile(
      path.join(f.remote, "profile.sav"),
      "reuploaded backup"
    );
    if (edited)
      await fsp.writeFile(path.join(f.local, "profile.sav"), "local edits");
    const result = await f.service.sync("Namespace:Item");
    assert.equal(result.status, edited ? "conflict" : "up-to-date");
    assert.equal(result.remoteManifest, f.state.manifest);
    assert.equal(result.remoteModifiedAt, f.state.lastModified);
    assert.equal(f.state.uploads, 0);
    // An edited copy downloads the remote once more to compare its content.
    assert.equal(f.state.downloads, 2);
    assert.equal(
      await fsp.readFile(path.join(f.local, "profile.sav"), "utf8"),
      edited ? "local edits" : "reuploaded backup"
    );
    assert.equal(
      await fsp.readFile(path.join(f.remote, "profile.sav"), "utf8"),
      "reuploaded backup"
    );
    if (!edited) {
      assert.equal(
        f.game().epicInstallation?.saveAnchor?.remoteManifest,
        f.state.manifest
      );
      assert.equal(
        f.game().epicInstallation?.saveAnchor?.remoteModifiedAt,
        f.state.lastModified
      );
      assert.equal(
        (await f.service.sync("Namespace:Item")).status,
        "up-to-date"
      );
      assert.equal(f.state.downloads, 2);
    }
  }
});

test("a same-name reupload invalidates the anchor and the displayed conflict choice", async (t) => {
  const f = await fixture(t);
  f.state.manifest = "2026.10.14-10.00.00.manifest";
  await fsp.writeFile(path.join(f.remote, "profile.sav"), "initial remote");
  assert.equal((await f.service.sync("Namespace:Item")).status, "up-to-date");
  await fsp.writeFile(path.join(f.local, "profile.sav"), "local edits");
  f.state.lastModified = "2026-10-15T12:00:00.000Z";
  await fsp.writeFile(path.join(f.remote, "profile.sav"), "reuploaded remote");
  const conflict = await f.service.sync("Namespace:Item");
  assert.equal(conflict.status, "conflict");
  f.state.lastModified = "2026-10-15T13:00:00.000Z";
  const result = await f.service.resolveConflict({
    epicObjectId: "Namespace:Item",
    expectedRemoteManifest: conflict.remoteManifest,
    expectedRemoteModifiedAt: conflict.remoteModifiedAt ?? null,
    choice: "local",
  });
  assert.equal(result.status, "conflict");
  assert.equal(f.state.uploads, 0);
  assert.equal(f.state.downloads, 2);
  assert.equal(
    await fsp.readFile(path.join(f.remote, "profile.sav"), "utf8"),
    "reuploaded remote"
  );
});

test("a same-name reupload during download cannot replace local files or confirm an upload", async (t) => {
  for (const direction of ["upload", "download"]) {
    const f = await fixture(t);
    if (direction === "download") {
      f.state.manifest = "2026.10.14-10.00.00.manifest";
      await fsp.writeFile(path.join(f.remote, "profile.sav"), "cloud save");
    } else await fsp.writeFile(path.join(f.local, "profile.sav"), "local save");
    f.state.beforeDownload = async () => {
      f.state.lastModified = "2026-10-15T14:00:00.000Z";
    };
    const result = await f.service.sync("Namespace:Item");
    assert.equal(
      result.status,
      direction === "download" ? "conflict" : "pending-upload"
    );
    assert.equal(
      result.error,
      direction === "download" ? "save-conflict" : "save-verification-failed"
    );
    assert.equal(f.game().epicInstallation?.saveAnchor, undefined);
    if (direction === "download")
      await assert.rejects(fsp.stat(path.join(f.local, "profile.sav")), {
        code: "ENOENT",
      });
    else
      assert.equal(
        await fsp.readFile(path.join(f.local, "profile.sav"), "utf8"),
        "local save"
      );
  }
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

for (const linux of [false, true]) {
  test(`${linux ? "Linux" : "Windows"} invalidation cancels saves waiting for a busy workspace without releasing its active task`, async (t) => {
    const f = await fixture(t, { linux });
    const releaseWorkspace = deferred<void>();
    const waiting = deferred<void>();
    let activeFinished = false;
    const active = queueEpicOperation(undefined, async () => {
      await releaseWorkspace.promise;
      activeFinished = true;
    });
    f.state.workspaceTail = active.queued;
    f.state.onWorkspaceQueued = () => waiting.resolve();
    f.game().epicInstallation!.pendingSaveUpload = true;
    await fsp.writeFile(path.join(f.local, "profile.sav"), "preserve local");
    const operation = f.service.sync("Namespace:Item");
    const cancelled = assert.rejects(operation, /operation-cancelled/);
    await waiting.promise;
    let invalidated = false;
    const invalidation = f.service.invalidate().then(() => {
      invalidated = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(invalidated, true);
      assert.equal(activeFinished, false);
      assert.equal(f.state.workspaceSignals.at(-1)?.aborted, true);
      assert.equal(f.state.workspaceExecutions, 0);
      assert.equal(f.state.commands.length, 0);
      assert.equal(f.game().epicInstallation?.pendingSaveUpload, true);
    } finally {
      releaseWorkspace.resolve();
      await Promise.all([invalidation, cancelled, active.result]);
      await f.state.workspaceTail?.catch(() => undefined);
    }
    assert.equal(f.state.workspaceExecutions, 0);
    assert.equal(f.state.commands.length, 0);
    assert.equal(
      await fsp.readFile(path.join(f.local, "profile.sav"), "utf8"),
      "preserve local"
    );
    assert.equal((await f.service.sync("Namespace:Item")).status, "up-to-date");
    assert.equal(f.state.uploads, 1);
  });
}

test("invalidation waits for an active capture and prevents its old generation from persisting or returning", async (t) => {
  const f = await fixture(t, { linux: true });
  const entered = deferred<void>();
  const release = deferred<void>();
  f.state.beforeMetadata = async () => {
    entered.resolve();
    await release.promise;
  };
  const capture = f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  const cancelled = assert.rejects(capture, /operation-cancelled/);
  await entered.promise;
  let invalidated = false;
  const invalidation = f.service.invalidate().then(() => {
    invalidated = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(invalidated, false);
    assert.equal(f.state.workspaceSignals.at(-1)?.aborted, true);
  } finally {
    release.resolve();
    await Promise.all([invalidation, cancelled]);
  }
  assert.equal(f.game().epicInstallation?.savePathSource, undefined);
  assert.equal(f.game().epicInstallation?.savePathPrefixGeneration, undefined);
  assert.equal(f.state.events.length, 0);
  assert.equal(f.state.commands.length, 0);
});

test("state invalidation cannot start a fresh local fallback capture", async (t) => {
  const f = await fixture(t);
  const entered = deferred<void>();
  const release = deferred<void>();
  f.state.beforeMetadata = async () => {
    entered.resolve();
    await release.promise;
  };
  const state = f.service.getState("Namespace:Item");
  await entered.promise;
  const invalidation = f.service.invalidate();
  release.resolve();
  await invalidation;
  assert.equal((await state).error, "operation-cancelled");
  assert.equal(f.state.workspaceExecutions, 1);
  assert.equal(f.state.events.length, 0);
});

test("settled captures detach cancellation after success and ownership lookup failure", async (t) => {
  for (const offline of [false, true]) {
    const f = await fixture(t);
    f.state.offline = offline;
    const controller = new AbortController();
    const capture = f.service.capture("Namespace:Item", controller.signal);
    if (offline) await assert.rejects(capture, /offline/);
    else await capture;
    const capturedSignal = f.state.captureSignals.at(-1)!;
    await f.service.invalidate();
    controller.abort();
    assert.equal(capturedSignal.aborted, false);
  }
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
  // Only the comparison download ran; the local save was not replaced.
  assert.equal(f.state.downloads, 1);
  assert.equal(
    await fsp.readFile(path.join(f.local, "profile.sav"), "utf8"),
    "session save"
  );
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

test("Linux default prefix is resolved for state, manual sync and anchors without launch-only context", async (t) => {
  const f = await fixture(t, { linux: true });
  f.state.folder = "{appdata}/Example";
  f.game().epicInstallation!.savePath = undefined;
  f.installed.save_path = null;
  await fsp.writeFile(
    path.join(f.workspace, "installed.json"),
    JSON.stringify({ Artifact: f.installed })
  );
  const expected = path.join(f.profile, "AppData", "Local", "Example");
  const captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(captured.savePath, expected);
  assert.equal(captured.winePrefixPath, f.prefix);
  assert.equal(captured.prefixGeneration, "generation-a");
  assert.equal(captured.savePathSource, "automatic");
  assert.equal((await f.service.getState("Namespace:Item")).savePath, expected);
  await fsp.mkdir(expected);
  await fsp.writeFile(path.join(expected, "profile.sav"), "linux save");
  assert.equal((await f.service.sync("Namespace:Item")).status, "up-to-date");
  assert.equal(f.game().epicInstallation?.savePathSource, "automatic");
  assert.equal(
    f.game().epicInstallation?.savePathPrefixGeneration,
    "generation-a"
  );
  assert.ok(f.state.prefixResolutions > 3);
});

test("Linux invalid prefix never falls back to host HOME, even for a retained absolute save path", async (t) => {
  const f = await fixture(t, { linux: true });
  f.state.prefixReady = false;
  f.state.folder = "{userprofile}/Game";
  const captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(captured.savePath, null);
  const state = await f.service.getState("Namespace:Item");
  assert.equal(state.savePath, null);
  assert.equal(state.error, "save-path-required");
  assert.equal(
    (await f.service.sync("Namespace:Item")).error,
    "save-path-required"
  );
  assert.equal(f.state.commands.length, 0);
});

test("Linux recreated prefix recalculates automatic paths and invalidates an old anchor before sync", async (t) => {
  const f = await fixture(t, { linux: true });
  const installation = f.game().epicInstallation!;
  installation.savePathSource = "automatic";
  installation.savePathPrefixGeneration = "generation-old";
  installation.saveAnchor = {
    localDigest: "old",
    remoteManifest: "2026.10.14-09.00.00.manifest",
  };
  f.state.folder = "{appdata}/Example";
  const expected = path.join(f.profile, "AppData", "Local", "Example");
  await fsp.mkdir(expected);
  await fsp.writeFile(path.join(expected, "profile.sav"), "new prefix local");
  await fsp.writeFile(path.join(f.remote, "profile.sav"), "remote");
  f.state.manifest = "2026.10.14-10.00.00.manifest";
  const captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(captured.savePath, expected);
  assert.equal(f.game().epicInstallation?.saveAnchor, undefined);
  assert.equal((await f.service.sync("Namespace:Item")).status, "conflict");
  assert.equal(f.state.uploads, 0);
  assert.equal(f.state.downloads, 1);
  assert.equal(
    await fsp.readFile(path.join(expected, "profile.sav"), "utf8"),
    "new prefix local"
  );
});

test("Linux first migration cannot adopt an ambiguous legacy path without recorded generation", async (t) => {
  const f = await fixture(t, { linux: true });
  f.state.folder = "{appdata}/Example";
  f.game().epicInstallation!.saveAnchor = {
    remoteManifest: null,
    localDigest: "legacy",
  };
  assert.equal(
    (await f.service.getState("Namespace:Item")).error,
    "save-path-required"
  );
  assert.equal(f.game().epicInstallation?.savePath, f.local);
  assert.equal(f.game().epicInstallation?.savePathSource, undefined);
  assert.equal(f.game().epicInstallation?.savePathPrefixGeneration, undefined);
  assert.equal(f.game().epicInstallation?.saveAnchor, undefined);
  assert.equal(
    (await f.service.sync("Namespace:Item")).error,
    "save-path-required"
  );
  assert.equal(f.state.commands.length, 0);
  await f.service.setSettings("Namespace:Item", {
    automaticSync: true,
    savePath: f.local,
  });
  const captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(captured.savePath, f.local);
  assert.equal(captured.savePathSource, "custom");
  assert.equal(
    f.game().epicInstallation?.savePathPrefixGeneration,
    "generation-a"
  );
});

test("Linux custom paths survive prefix changes while ambiguous legacy paths require an explicit choice", async (t) => {
  const f = await fixture(t, { linux: true });
  f.state.folder = "{appdata}/Example";
  const installation = f.game().epicInstallation!;
  installation.savePathPrefixGeneration = "generation-old";
  installation.saveAnchor = { remoteManifest: null, localDigest: "old" };
  let captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(captured.savePath, null);
  assert.equal(f.game().epicInstallation?.savePath, f.local);
  assert.equal(
    f.game().epicInstallation?.savePathPrefixGeneration,
    "generation-old"
  );
  assert.equal(f.game().epicInstallation?.saveAnchor, undefined);
  captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(captured.savePath, null);
  await f.service.setSettings("Namespace:Item", {
    automaticSync: true,
    savePath: f.local,
  });
  captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(captured.savePath, f.local);
  assert.equal(captured.savePathSource, "custom");
  f.state.prefixGeneration = "generation-next";
  captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(captured.savePath, f.local);
  assert.equal(captured.savePathSource, "custom");
});

test("Linux clearing custom saves returns to metadata and commitAnchor preserves explicit provenance", async (t) => {
  const f = await fixture(t, { linux: true });
  f.state.folder = "{appdata}/Example";
  await f.service.setSettings("Namespace:Item", {
    automaticSync: true,
    savePath: f.local,
  });
  await fsp.writeFile(path.join(f.local, "profile.sav"), "custom");
  assert.equal((await f.service.sync("Namespace:Item")).status, "up-to-date");
  assert.equal(f.game().epicInstallation?.savePathSource, "custom");
  await f.service.setSettings("Namespace:Item", {
    automaticSync: true,
    savePath: null,
  });
  const captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  assert.equal(
    captured.savePath,
    path.join(f.profile, "AppData", "Local", "Example")
  );
  assert.equal(captured.savePathSource, "automatic");
  assert.equal(f.game().epicInstallation?.saveAnchor, undefined);
});

test("Linux prefix lease blocks manual work but permits its own prelaunch restore and post-exit upload", async (t) => {
  const f = await fixture(t, { linux: true });
  await fsp.writeFile(path.join(f.local, "profile.sav"), "local");
  f.state.prefixBusy = true;
  assert.equal(
    (await f.service.sync("Namespace:Item")).error,
    "compatibility-prefix-busy"
  );
  assert.equal(f.state.commands.length, 0);
  const captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  captured.linuxPrefixLeaseId = f.state.leaseId;
  await f.service.runLaunchGate("Namespace:Item", () =>
    f.service.beforeLaunch(captured)
  );
  await f.service.markSessionStarted(captured);
  await fsp.writeFile(path.join(f.local, "profile.sav"), "played");
  assert.equal((await f.service.afterClose(captured))?.status, "up-to-date");
  assert.equal(f.state.mutationLeases.at(-1), f.state.leaseId);
  assert.equal(f.state.uploads, 2);
});

test("Linux generation changes after capture block launch and preserve pending post-exit saves", async (t) => {
  const f = await fixture(t, { linux: true });
  const captured = await f.service.capture(
    "Namespace:Item",
    new AbortController().signal
  );
  await f.service.markSessionStarted(captured);
  f.state.prefixGeneration = "recreated";
  await assert.rejects(
    f.service.markSessionStarted(captured),
    /compatibility-prefix-invalid/
  );
  const result = await f.service.afterClose(captured);
  assert.equal(result?.status, "pending-upload");
  assert.equal(result?.error, "compatibility-prefix-invalid");
  assert.equal(f.state.commands.length, 0);
  assert.equal(f.game().epicInstallation?.pendingSaveUpload, true);
});
