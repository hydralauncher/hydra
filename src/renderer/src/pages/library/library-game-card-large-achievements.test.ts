import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import ts from "typescript";

const requireModule = createRequire(import.meta.url);

it("refreshes grouped progress on member changes and preserves known offline totals", async () => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  let calls = 0;
  let response: Array<{ unlocked: boolean }> = [];
  Object.assign(dom.window, {
    electron: {
      getUnlockedAchievements: async () => {
        calls++;
        return response;
      },
    },
  });
  const stubs: Record<string, unknown> = {
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
    "./library-category": { getLibraryPresentationBadgeSource: () => "steam" },
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
  const filename = new URL("./library-game-card-large.tsx", import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename.pathname,
  }).outputText;
  const exported: Record<string, React.ElementType> = {};
  new Function("exports", "require", output)(exported, (name: string) =>
    name.endsWith(".scss") ? {} : (stubs[name] ?? requireModule(name))
  );
  const root = createRoot(dom.window.document.getElementById("root")!);
  const member = {
    shop: "epic",
    objectId: "epic-10",
    achievementCount: 3,
    unlockedAchievementCount: 0,
  };
  const game = {
    id: "10",
    objectId: "10",
    shop: "steam",
    title: "Game",
    achievementCount: 3,
    unlockedAchievementCount: 1,
    availableShops: ["steam", "epic"],
    members: [member],
  };
  const render = async (value: typeof game) => {
    await act(async () => {
      root.render(
        React.createElement(exported.LibraryGameCardLarge, {
          game: value,
          onContextMenu: () => {},
        })
      );
    });
    return JSON.parse(
      dom.window.document.querySelector("output")!.textContent!
    );
  };
  try {
    const emptyEpic = {
      id: "epic:copy",
      objectId: "copy",
      shop: "epic",
      title: "Epic Copy",
      achievementCount: 0,
      unlockedAchievementCount: 0,
      catalogueGame: { shop: "steam", objectId: "752590" },
    };
    response = [{ unlocked: true }, { unlocked: false }, { unlocked: false }];
    const fallback = await render(emptyEpic as unknown as typeof game);
    assert.equal(calls, 1);
    assert.equal(fallback.achievementCount, 3);
    assert.equal(fallback.unlockedAchievementCount, 1);
    response = [];
    const unavailable = await render({
      ...emptyEpic,
      catalogueGame: { shop: "steam", objectId: "999" },
    } as unknown as typeof game);
    assert.equal(calls, 2);
    assert.deepEqual(unavailable, fallback);
    await act(async () => root.render(React.createElement("div")));
    calls = 0;
    response = [];
    const first = await render(game);
    assert.equal(calls, 1);
    assert.equal(first.achievementCount, 3);
    assert.equal(first.unlockedAchievementCount, 1);
    response = [{ unlocked: true }, { unlocked: true }, { unlocked: false }];
    const updated = {
      ...game,
      members: [{ ...member, unlockedAchievementCount: 1 }],
    };
    const second = await render(updated);
    assert.equal(calls, 2);
    assert.equal(second.achievementCount, 3);
    assert.equal(second.unlockedAchievementCount, 2);
    response = [];
    const offline = await render({
      ...updated,
      members: [{ ...member, objectId: "epic-new" }],
    });
    assert.equal(calls, 3);
    assert.deepEqual(offline, second);
    await render({ ...updated, members: [] });
    assert.equal(calls, 4);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, globals);
    dom.window.close();
  }
});
