import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { it, mock } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ts from "typescript";

const requireModule = createRequire(import.meta.url);

const transpile = (relativePath: string) => {
  const filename = new URL(relativePath, import.meta.url);
  return ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename.pathname,
  }).outputText;
};

const load = (
  relativePath: string,
  resolve: (name: string) => unknown
): Record<string, unknown> => {
  const exported: Record<string, unknown> = {};
  new Function("exports", "require", transpile(relativePath))(
    exported,
    resolve
  );
  return exported;
};

it("shows stored progress and requests combined progress once instead of fetching achievements", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const dom = new JSDOM("<div id='root'></div>");
  const globals = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let fetches = 0;
  const ensured: string[] = [];
  Object.assign(dom.window, {
    electron: {
      getUnlockedAchievements: async () => {
        fetches++;
        return [];
      },
      ensureAchievementProgress: async (shop: string, objectId: string) => {
        ensured.push(`${shop}:${objectId}`);
        return null;
      },
    },
  });
  const ensureModule = load("./use-ensure-achievement-progress.ts", (name) =>
    requireModule(name)
  );
  const stubs: Record<string, unknown> = {
    "./use-ensure-achievement-progress": ensureModule,
    "@renderer/hooks": {
      useGameCard: () => ({
        formatPlayTime: () => "0",
        handleCardClick: () => {},
        handleContextMenuClick: () => {},
      }),
      useAppSelector: () => ({}),
      useCoverPoster: () => undefined,
      isAnimatedCoverCandidate: () => false,
      useAnimatedSourceWarmup: () => {},
    },
    "./library-category": {
      getLibraryPresentationImportSources: () => ({
        steam: true,
        epic: false,
      }),
    },
    "@shared": { getDisplayedPlayTimeInMilliseconds: () => 0 },
    "@renderer/helpers": {
      CLASSICS_PS_PLATFORM_LABELS: {},
      isGameReadyToPlay: () => false,
      resolveClassicsBadge: () => ({}),
    },
    "@renderer/components": {
      SteamLibraryBadge: () => null,
      AchievementProgress: (props: Record<string, unknown>) =>
        React.createElement("output", null, JSON.stringify(props)),
    },
    "@renderer/components/game-visibility-badge/game-visibility-badge": {
      GameVisibilityBadge: () => null,
    },
    "@renderer/pages/settings/emulation/emulator-icons": { EMULATOR_ICONS: {} },
    "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
  };
  const exported = load("./library-game-card-large.tsx", (name) =>
    name.endsWith(".scss") ? {} : (stubs[name] ?? requireModule(name))
  ) as Record<string, React.ElementType>;
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = async (game: Record<string, unknown>) => {
    await act(async () => {
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(exported.LibraryGameCardLarge, {
            game,
            onContextMenu: () => {},
          })
        )
      );
    });
    await act(async () => mock.timers.tick(1_000));
    const output = dom.window.document.querySelector("output");
    return output ? JSON.parse(output.textContent!) : null;
  };
  try {
    const borrowed = await render({
      id: "epic:copy",
      objectId: "copy",
      shop: "epic",
      title: "Epic Copy",
      achievementCount: 0,
      unlockedAchievementCount: 0,
      catalogueGame: { shop: "steam", objectId: "752590" },
    });
    assert.equal(borrowed, null);
    assert.deepEqual(ensured, ["epic:copy"]);

    await render({
      id: "epic:copy",
      objectId: "copy",
      shop: "epic",
      title: "Epic Copy",
      achievementCount: 3,
      unlockedAchievementCount: 1,
      catalogueGame: { shop: "steam", objectId: "752590" },
    });
    assert.deepEqual(ensured, ["epic:copy"]);

    const fresh = await render({
      id: "10",
      objectId: "10",
      shop: "steam",
      title: "Game",
      achievementCount: 45,
      unlockedAchievementCount: 24,
      availableShops: ["steam", "epic"],
      achievementProgress: {
        achievementCount: 45,
        unlockedAchievementCount: 24,
        updatedAt: Date.now(),
      },
    });
    assert.equal(fresh.achievementCount, 45);
    assert.equal(fresh.unlockedAchievementCount, 24);
    assert.deepEqual(ensured, ["epic:copy"]);

    await render({
      id: "11",
      objectId: "11",
      shop: "steam",
      title: "Stale",
      achievementCount: 10,
      unlockedAchievementCount: 2,
      availableShops: ["steam", "epic"],
      achievementProgress: {
        achievementCount: 10,
        unlockedAchievementCount: 2,
        updatedAt: Date.now() - 25 * 60 * 60 * 1000,
      },
    });
    assert.deepEqual(ensured, ["epic:copy", "steam:11"]);

    const plain = await render({
      id: "12",
      objectId: "12",
      shop: "steam",
      title: "Plain",
      achievementCount: 8,
      unlockedAchievementCount: 5,
      availableShops: ["steam"],
    });
    assert.equal(plain.achievementCount, 8);
    assert.equal(plain.unlockedAchievementCount, 5);
    assert.deepEqual(ensured, ["epic:copy", "steam:11"]);
    assert.equal(fetches, 0);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, globals);
    dom.window.close();
    mock.timers.reset();
  }
});
