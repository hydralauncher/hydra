import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type { LibraryGame } from "@types";
import { applyLibraryGroupAction } from "../../../shared/library-group-actions.js";
import { findLibraryGamePresentation } from "../../../shared/library-catalogue.js";

const requireModule = createRequire(import.meta.url);
const { act } = React;
const epic = {
  id: "epic:namespace:executable",
  shop: "epic",
  objectId: "namespace:executable",
  title: "Preferred catalogue title",
  canonicalId: "canonical-game",
  catalogueGame: { shop: "steam", objectId: "123" },
  availableShops: ["steam", "epic"],
  hasActiveEpicImport: true,
  playTimeInMilliseconds: 1000,
  epicPlayTimeInMilliseconds: 3000,
  executablePath: "epic.exe",
  favorite: false,
  isDeleted: false,
} as LibraryGame;

async function fixture(
  games: LibraryGame[],
  runningId?: string,
  freshGame?: LibraryGame
) {
  const dom = new JSDOM("<div id='root'></div>");
  const keys = ["window", "document", "Event", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key)
  );
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const calls: [string, ...unknown[]][] = [];
  const bridge = {
    getLibrary: async () => games,
    getGameByObjectId: async (shop: string, objectId: string) => {
      calls.push(["game", shop, objectId]);
      if (freshGame?.shop === shop && freshGame.objectId === objectId)
        return freshGame;
      return (
        games.find(
          (game) => game.shop === shop && game.objectId === objectId
        ) ?? null
      );
    },
    getGameShopDetails: async (objectId: string, shop: string) => {
      calls.push(["details", shop, objectId]);
      return null;
    },
    getGameStats: async () => null,
    getGameAssets: async () => ({ title: "Steam details" }),
    getUnlockedAchievements: async (objectId: string, shop: string) => {
      calls.push(["achievements", shop, objectId]);
      return [];
    },
    hydraApi: { get: async () => null },
    onLibraryBatchComplete: () => () => {},
    syncEpicGameOnGamePage: async (objectId: string) => {
      calls.push(["sync", "epic", objectId]);
      return false;
    },
    syncSteamGameOnGamePage: async (objectId: string) => {
      calls.push(["sync", "steam", objectId]);
      return false;
    },
    addGameToFavorites: async (shop: string, objectId: string) => {
      calls.push(["favorite", shop, objectId]);
    },
    openGame: (shop: string, objectId: string) => {
      calls.push(["open", shop, objectId]);
    },
  };
  Object.assign(dom.window, { electron: bridge });
  const filename = "src/big-picture/src/hooks/use-game-details.hook.ts";
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  const exports: Record<string, unknown> = {};
  const stubs: Record<string, unknown> = {
    react: React,
    "@shared": { applyLibraryGroupAction, findLibraryGamePresentation },
    "react-i18next": { useTranslation: () => ({ i18n: { language: "en" } }) },
    "../constants": { IS_DESKTOP: true },
    "./use-library.hook": {
      useLibrary: () => ({
        downloadLibrary: games,
        updateLibrary: refreshLibrary,
      }),
    },
    "./use-big-picture-running-games.hook": {
      useBigPictureRunningGames: () => runningGames,
    },
    "./use-user-preferences.hook": { useUserPreferences: () => null },
    "./use-big-picture-toast.hook": {
      useBigPictureToast: () => ({
        showSuccessToast() {
          return undefined;
        },
        showErrorToast() {
          return undefined;
        },
      }),
    },
    "../services": {
      NavigationAudioService: {
        getInstance: () => ({
          play() {
            return undefined;
          },
        }),
      },
    },
    "../helpers": {
      resolvePreferredGameAssets: (game: LibraryGame | null) => ({
        title: game?.title,
      }),
      buildFavoriteToastOptions: async () => ({ title: "Updated" }),
      buildGameToastVisualOptions: async () => ({}),
    },
  };
  const runningGames = runningId
    ? { [runningId]: { id: runningId, sessionDurationInMillis: 10000 } }
    : {};
  async function refreshLibrary() {
    return undefined;
  }
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
  );
  const useDetails = exports.useGameDetails as (
    objectId: string,
    shop: string
  ) => {
    game: LibraryGame | null;
    presentationGame: LibraryGame & { members: LibraryGame[] };
    catalogueGame: { shop: string; objectId: string };
    isGameRunning: boolean;
    openGame: () => Promise<void>;
    toggleFavorite: () => Promise<void>;
  };
  let current: ReturnType<typeof useDetails>;
  function Component() {
    current = useDetails("123", "steam");
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root.render(React.createElement(Component));
  });
  return {
    get details() {
      return current;
    },
    calls,
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      keys.forEach((key, index) => {
        if (previous[index])
          Object.defineProperty(globalThis, key, previous[index]!);
        else Reflect.deleteProperty(globalThis, key);
      });
    },
  };
}

describe("Big Picture catalogue page", () => {
  it("opens Steam metadata while keeping an Epic-only import operational", async () => {
    const state = await fixture([epic]);
    try {
      assert.equal(state.details.game, epic);
      assert.deepEqual(
        state.calls.filter(([action]) => action === "game"),
        [["game", "epic", epic.objectId]]
      );
      assert.deepEqual(state.details.catalogueGame, {
        shop: "steam",
        objectId: "123",
      });
      assert.deepEqual(state.details.presentationGame.members, [epic]);
      assert.ok(
        state.calls.some(
          ([action, shop, id]) =>
            action === "details" && shop === "steam" && id === "123"
        )
      );
      assert.ok(
        state.calls.some(
          ([action, shop, id]) =>
            action === "sync" && shop === "epic" && id === epic.objectId
        )
      );
      assert.ok(
        state.calls.some(
          ([action, shop, id]) =>
            action === "achievements" && shop === "epic" && id === epic.objectId
        )
      );
      await state.details.openGame();
      assert.ok(
        state.calls.some(
          ([action, shop, id]) =>
            action === "open" && shop === "epic" && id === epic.objectId
        )
      );
      assert.equal(epic.playTimeInMilliseconds, 1000);
    } finally {
      await state.close();
    }
  });

  it("keeps fresh operational Hydra time separate from the grouped reading total", async () => {
    const freshGame = { ...epic, playTimeInMilliseconds: 9000 };
    const state = await fixture([epic], undefined, freshGame);
    try {
      assert.equal(state.details.game, freshGame);
      assert.equal(state.details.game.playTimeInMilliseconds, 9000);
      assert.equal(state.details.game.epicPlayTimeInMilliseconds, 3000);
      assert.ok(
        state.calls
          .filter(([action]) => action === "game")
          .every(([, shop, id]) => shop === "epic" && id === epic.objectId)
      );
      assert.equal(epic.playTimeInMilliseconds, 1000);
    } finally {
      await state.close();
    }
  });

  it("sums both copies for reading and favorites their real identities", async () => {
    const steam = {
      ...epic,
      id: "steam:123",
      objectId: "123",
      shop: "steam",
      executablePath: null,
      playTimeInMilliseconds: 2000,
      epicPlayTimeInMilliseconds: 0,
      steamPlayTimeInMilliseconds: 5000,
      hasActiveEpicImport: false,
      hasActiveSteamImport: true,
    } as LibraryGame;
    const state = await fixture([epic, steam], epic.id);
    try {
      assert.equal(state.details.game, epic);
      assert.equal(state.details.isGameRunning, true);
      assert.equal(state.details.presentationGame.playTimeInMilliseconds, 3000);
      assert.equal(
        state.details.presentationGame.epicPlayTimeInMilliseconds,
        3000
      );
      assert.equal(
        state.details.presentationGame.steamPlayTimeInMilliseconds,
        5000
      );
      await act(async () => state.details.toggleFavorite());
      assert.deepEqual(
        state.calls.filter(([action]) => action === "favorite"),
        [
          ["favorite", "epic", epic.objectId],
          ["favorite", "steam", "123"],
        ]
      );
      assert.equal(epic.playTimeInMilliseconds, 1000);
      assert.equal(steam.playTimeInMilliseconds, 2000);
    } finally {
      await state.close();
    }
  });
});
