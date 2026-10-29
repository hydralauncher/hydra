import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type {
  EpicGameInstallOptions,
  LibraryGame,
  StartEpicGameUpdatePayload,
} from "@types";
import * as officialStoreOptions from "../../../shared/official-store-options.js";
import type { useEpicGameUpdate } from "./use-epic-game-update";

const requireModule = createRequire(import.meta.url);
function loadHook() {
  const filename = "./use-epic-game-update.ts";
  const { outputText } = ts.transpileModule(
    fs.readFileSync(new URL(filename, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      fileName: filename,
    }
  );
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(exports, (name: string) =>
    name === "@shared" ? officialStoreOptions : requireModule(name)
  );
  return exports.useEpicGameUpdate as typeof useEpicGameUpdate;
}

const game = {
  id: "epic:Namespace:Item",
  shop: "epic",
  objectId: "Namespace:Item",
  executablePath: "C:\\Games\\Game\\Game.exe",
  isDeleted: false,
  hasActiveEpicImport: true,
  epicInstallation: {
    owner: { environment: "test", userId: "user", epicAccountId: "account" },
    artifactId: "Artifact",
    platform: "Windows",
  },
} as LibraryGame;

const options = (
  overrides: Partial<EpicGameInstallOptions["options"][number]> = {},
  error?: EpicGameInstallOptions["error"]
): EpicGameInstallOptions => ({
  connectionId: "connection",
  options: [
    {
      preparationId: "ecb21ce2-bd02-4672-a2fb-ce13f481b00a",
      artifactId: "Artifact",
      platform: "Windows",
      downloadSizeInBytes: 10,
      diskSizeInBytes: 20,
      supportsCloudSaves: false,
      installed: true,
      publishedVersion: "build-2",
      installedVersion: "build-1",
      ...overrides,
    },
  ],
  ...(error ? { error, options: [] } : {}),
});

async function fixture(t: TestContext, bridge: Record<string, unknown>) {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  let connectionChanged: (() => void) | undefined;
  Object.assign(dom.window, {
    electron: {
      onEpicConnectionChanged: (listener: () => void) => {
        connectionChanged = listener;
        return () => {
          connectionChanged = undefined;
        };
      },
      cancelEpicGameInstallOptions: async () => {},
      ...bridge,
    },
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const useHook = loadHook();
  const current: { value?: ReturnType<typeof useEpicGameUpdate> } = {};
  function Harness({
    target,
    enabled,
  }: Readonly<{ target: LibraryGame | null; enabled: boolean }>) {
    current.value = useHook(target, enabled);
    return null;
  }
  const render = async (target: LibraryGame | null, enabled = true) =>
    React.act(async () =>
      root.render(React.createElement(Harness, { target, enabled }))
    );
  return {
    current,
    render,
    changeConnection: async () =>
      React.act(async () => {
        connectionChanged?.();
      }),
  };
}

describe("useEpicGameUpdate", () => {
  it("offers the installed artifact's newer build and starts it without a folder", async (t) => {
    const starts: StartEpicGameUpdatePayload[] = [];
    const f = await fixture(t, {
      getEpicGameInstallOptions: async () => options(),
      startEpicGameUpdate: async (payload: StartEpicGameUpdatePayload) => {
        starts.push(payload);
        return { ok: true };
      },
    });
    await f.render(game);
    assert.equal(f.current.value?.update?.publishedVersion, "build-2");
    let result;
    await React.act(async () => {
      result = await f.current.value!.start(true);
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(starts, [
      {
        epicObjectId: "Namespace:Item",
        connectionId: "connection",
        artifactId: "Artifact",
        platform: "Windows",
        preparationId: "ecb21ce2-bd02-4672-a2fb-ce13f481b00a",
        addToQueueOnly: true,
      },
    ]);
  });

  it("stays silent when the game is current, not installed or Epic is unavailable", async (t) => {
    const requests: string[] = [];
    let response = options({ installedVersion: "build-2" });
    const f = await fixture(t, {
      getEpicGameInstallOptions: async (objectId: string) => {
        requests.push(objectId);
        return response;
      },
      startEpicGameUpdate: async () => ({ ok: true }),
    });
    await f.render(game);
    assert.equal(f.current.value?.update, null);
    response = options({}, "session-expired");
    await f.changeConnection();
    assert.equal(f.current.value?.update, null);
    assert.equal(requests.length, 2);
    await f.render({ ...game, executablePath: null });
    await f.render(game, false);
    assert.equal(requests.length, 2);
    assert.deepEqual(await f.current.value!.start(), {
      ok: false,
      error: "stale-connection",
    });
  });

  it("discards the cached preview only for a fresh refresh", async (t) => {
    const invalidated: string[] = [];
    let response = options({ installedVersion: "build-2" });
    const f = await fixture(t, {
      getEpicGameInstallOptions: async () => response,
      invalidateEpicGameInstallOptions: async (objectId: string) => {
        invalidated.push(objectId);
        response = options({ publishedVersion: "build-3" });
      },
      startEpicGameUpdate: async () => ({ ok: true }),
    });
    await f.render(game);
    assert.deepEqual(invalidated, []);
    await React.act(async () => f.current.value!.refresh(true));
    assert.deepEqual(invalidated, ["Namespace:Item"]);
    assert.equal(f.current.value?.update?.publishedVersion, "build-3");
  });

  it("resumes an interrupted update for the installed artifact without a newer build", async (t) => {
    const starts: StartEpicGameUpdatePayload[] = [];
    const f = await fixture(t, {
      getEpicGameInstallOptions: async () =>
        options({ installedVersion: "build-2" }),
      startEpicGameUpdate: async (payload: StartEpicGameUpdatePayload) => {
        starts.push(payload);
        return { ok: true };
      },
    });
    await f.render(game);
    assert.deepEqual(await f.current.value!.start(), {
      ok: false,
      error: "stale-connection",
    });
    let result;
    await React.act(async () => {
      result = await f.current.value!.start(false, true);
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(starts, [
      {
        epicObjectId: "Namespace:Item",
        connectionId: "connection",
        artifactId: "Artifact",
        platform: "Windows",
        addToQueueOnly: false,
      },
    ]);
  });

  it("refreshes after a launch reports the build is out of date", async (t) => {
    let response = options({ installedVersion: "build-2" });
    const f = await fixture(t, {
      getEpicGameInstallOptions: async () => response,
      startEpicGameUpdate: async () => ({
        ok: false,
        error: "operation-in-progress",
      }),
    });
    const update = () => f.current.value?.update;
    await f.render(game);
    assert.equal(update(), null);
    response = options({ publishedVersion: "build-3" });
    await React.act(async () => f.current.value!.refresh());
    assert.equal(update()?.publishedVersion, "build-3");
    let result;
    await React.act(async () => {
      result = await f.current.value!.start();
    });
    assert.deepEqual(result, { ok: false, error: "operation-in-progress" });
  });
});
