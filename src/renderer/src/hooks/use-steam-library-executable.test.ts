import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";

const requireModule = createRequire(import.meta.url);

function loadHookModule() {
  const filename = "src/renderer/src/hooks/use-steam-library-executable.ts";
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(exports, (name: string) =>
    name === "react" ? React : requireModule(name)
  );
  return exports.useIsSteamLibraryExecutable as (
    game: unknown,
    enabled?: boolean
  ) => boolean | null;
}

const useIsSteamLibraryExecutable = loadHookModule();

const makeGame = (overrides: Record<string, unknown> = {}) => ({
  id: "steam:123",
  shop: "steam",
  objectId: "123",
  title: "Game",
  executablePath: "/steam/steamapps/common/Game/game.exe",
  hasActiveSteamImport: true,
  isDeleted: false,
  ...overrides,
});

function prepareDom(t: TestContext) {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );

  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }

  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  return dom;
}

function renderHook(dom: JSDOM) {
  const state: { result: boolean | null } = { result: null };
  const root = createRoot(dom.window.document.getElementById("root")!);
  const Probe = ({ game, enabled }: { game: unknown; enabled: boolean }) => {
    state.result = useIsSteamLibraryExecutable(game, enabled);
    return null;
  };

  const update = async (game: unknown, enabled: boolean) =>
    React.act(async () => {
      root.render(React.createElement(Probe, { game, enabled }));
    });

  return { state, update, root };
}

describe("useIsSteamLibraryExecutable", () => {
  it("does not call the Steam executable bridge while disabled", async (t) => {
    const dom = prepareDom(t);
    let calls = 0;
    Object.assign(dom.window, {
      electron: {
        isSteamAppExecutable: async () => {
          calls += 1;
          return true;
        },
      },
    });

    const game = makeGame();
    const { state, update, root } = renderHook(dom);

    await update(game, false);

    assert.equal(state.result, null);
    assert.equal(calls, 0);

    await React.act(async () => root.unmount());
  });

  it("drops a stale executable result when the game path changes", async (t) => {
    const dom = prepareDom(t);
    let resolveFirst!: (value: boolean) => void;
    let calls = 0;
    Object.assign(dom.window, {
      electron: {
        isSteamAppExecutable: () => {
          calls += 1;
          return new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          });
        },
      },
    });

    let game = makeGame();
    const { state, update, root } = renderHook(dom);

    await update(game, true);
    assert.equal(state.result, null);
    assert.equal(calls, 1);

    await React.act(async () => {
      resolveFirst(true);
      await Promise.resolve();
    });
    assert.equal(state.result, true);

    game = makeGame({ executablePath: "/other/game.exe" });
    await update(game, true);
    assert.equal(state.result, null);
    assert.equal(calls, 2);

    await React.act(async () => root.unmount());
  });

  it("shares an in-flight executable check between consumers", async (t) => {
    const dom = prepareDom(t);
    let resolveCheck!: (value: boolean) => void;
    let calls = 0;
    Object.assign(dom.window, {
      electron: {
        isSteamAppExecutable: () => {
          calls += 1;
          return new Promise<boolean>((resolve) => {
            resolveCheck = resolve;
          });
        },
      },
    });

    const results: (boolean | null)[] = [null, null];
    const game = makeGame();
    const root = createRoot(dom.window.document.getElementById("root")!);
    const Probe = ({ index }: { index: number }) => {
      results[index] = useIsSteamLibraryExecutable(game, true);
      return null;
    };

    await React.act(async () =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Probe, { index: 0 }),
          React.createElement(Probe, { index: 1 })
        )
      )
    );

    assert.equal(calls, 1);

    await React.act(async () => {
      resolveCheck(true);
      await Promise.resolve();
    });
    assert.deepEqual(results, [true, true]);

    await React.act(async () => root.unmount());
  });
});
