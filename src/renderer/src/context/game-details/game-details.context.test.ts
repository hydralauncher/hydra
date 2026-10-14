import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type { Download, DownloadProgress, LibraryGame } from "@types";
import type { GameDetailsContext } from "./game-details.context.types";
import {
  findLibraryGamePresentation,
  isLibraryGameDownloading,
  mergeLibraryCatalogueMetadata,
} from "../../../../shared/library-catalogue.js";
import { getDisplayedPlayTimeInMilliseconds } from "../../../../shared/playtime.js";

const requireModule = createRequire(import.meta.url);

function loadModule(filename: string, stubs: Record<string, unknown>) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
  );
  return exports;
}
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
  isDeleted: false,
} as LibraryGame;

async function fixture(
  t: TestContext,
  games: LibraryGame[],
  runningId?: string,
  initialLastPacket: DownloadProgress | null = null
) {
  let libraryGames = games;
  let lastPacket = initialLastPacket;
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://hydra.test/game/steam/123",
  });
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
  const calls: [string, ...unknown[]][] = [];
  const unsubscribe = () => {};
  const bridge = {
    getGameByObjectId: async (shop: string, objectId: string) => {
      calls.push(["game", shop, objectId]);
      return (
        games.find(
          (game) => game.shop === shop && game.objectId === objectId
        ) ?? null
      );
    },
    getGameShopDetails: async (objectId: string, shop: string) => {
      calls.push(["details", shop, objectId]);
      return {
        name: "Steam metadata",
        content_descriptors: { ids: [] },
        assets: {},
      };
    },
    getGameAssets: async (objectId: string, shop: string) => {
      calls.push(["assets", shop, objectId]);
      return { title: "Steam assets" };
    },
    getGameStats: async () => null,
    getUnlockedAchievements: async (objectId: string, shop: string) => {
      calls.push(["achievements", shop, objectId]);
      return [];
    },
    syncEpicGameOnGamePage: async (objectId: string) => {
      calls.push(["sync", "epic", objectId]);
      return false;
    },
    syncSteamGameOnGamePage: async (objectId: string) => {
      calls.push(["sync", "steam", objectId]);
      return false;
    },
    onUpdateAchievements: (objectId: string, shop: string) => {
      calls.push(["achievement-listener", shop, objectId]);
      return unsubscribe;
    },
    onGamesRunning: () => unsubscribe,
    onLibraryBatchComplete: () => unsubscribe,
    on: unsubscribe,
    off: unsubscribe,
    hydraApi: { get: async () => [] },
  };
  Object.assign(dom.window, { electron: bridge });
  const dispatch = () => {};
  const userDetails = { id: "owner" };
  const location = { pathname: "/game/steam/123", state: null };
  const preferencesState = { userPreferences: { value: null } };
  const presentationHook = loadModule(
    "src/renderer/src/hooks/use-library-game-presentation.ts",
    {
      "@shared": { findLibraryGamePresentation, mergeLibraryCatalogueMetadata },
      "./use-library": {
        useLibrary: () => ({ downloadLibrary: libraryGames }),
      },
      "./redux": {
        useAppSelector: (select: (state: unknown) => unknown) =>
          select({
            gameRunning: { gameRunning: runningId ? { id: runningId } : null },
          }),
      },
    }
  );
  const stubs: Record<string, unknown> = {
    "@renderer/features": { setHeaderTitle: (title: string) => ({ title }) },
    "@renderer/services/leveldb.service": {
      levelDBService: { values: async () => [] },
    },
    "@renderer/helpers": {
      ensureArray: (value: unknown) => (Array.isArray(value) ? value : []),
    },
    "lodash-es": { orderBy: (values: unknown[]) => values },
    "react-i18next": {
      useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "en" },
      }),
    },
    "react-router-dom": { useLocation: () => location },
    "@renderer/hooks": {
      useAppDispatch: () => dispatch,
      useAppSelector: (selector: (state: typeof preferencesState) => unknown) =>
        selector(preferencesState),
      useDownload: () => ({ lastPacket }),
      useUserDetails: () => ({ userDetails }),
      useLibraryGamePresentation: presentationHook.useLibraryGamePresentation,
    },
    "@shared": {
      SteamContentDescriptor: { AdultOnlySexualContent: 3 },
      filterDownloadableRepacks: (values: unknown[]) => values,
      fetchHosterAvailability: async () => [],
      applyHosterAvailability: (values: unknown[]) => values,
      getGameExecutableFilters: () => [],
    },
  };
  const filename =
    "src/renderer/src/context/game-details/game-details.context.tsx";
  const exports = loadModule(filename, stubs);
  const context =
    exports.gameDetailsContext as React.Context<GameDetailsContext>;
  const Provider = exports.GameDetailsContextProvider as React.ElementType;
  let current!: GameDetailsContext;
  function Probe() {
    current = React.useContext(context);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const render = () =>
    React.act(async () => {
      root.render(
        React.createElement(
          Provider,
          { shop: "steam", objectId: "123", gameTitle: "Steam title" },
          React.createElement(Probe)
        )
      );
    });
  await render();
  return {
    calls,
    async updateLibrary(
      updatedGames: LibraryGame[],
      updatedLastPacket: DownloadProgress | null = lastPacket
    ) {
      libraryGames = updatedGames;
      lastPacket = updatedLastPacket;
      await render();
    },
    get details() {
      return current;
    },
  };
}

describe("Desktop catalogue page", () => {
  for (const status of [
    "paused",
    "removed",
    "complete",
    "error",
    null,
    undefined,
  ] as const) {
    it(`uses the live library download after an active download becomes ${status} and its packet clears`, async (t) => {
      const downloading = {
        ...epic,
        download: { status: "active", progress: 0.25 } as Download,
      };
      const packet = {
        gameId: downloading.id,
        download: downloading.download,
        progress: 0.25,
      } as DownloadProgress;
      const state = await fixture(t, [downloading], undefined, packet);
      assert.equal(state.details.game, downloading);
      assert.equal(isLibraryGameDownloading(state.details.downloadGame), true);
      const updated = {
        ...downloading,
        download:
          status == null
            ? null
            : {
                ...downloading.download,
                status,
                progress: status === "complete" ? 1 : 0.25,
                extracting: false,
              },
      };
      if (status === undefined) Reflect.deleteProperty(updated, "download");

      await state.updateLibrary([updated], null);

      assert.equal(state.details.game, downloading);
      assert.equal(state.details.game?.download?.status, "active");
      assert.equal(state.details.downloadGame?.download, updated.download);
      assert.equal(isLibraryGameDownloading(state.details.downloadGame), false);
      assert.equal(downloading.download.status, "active");
    });
  }

  it("keeps extraction disabled until the live library clears its extracting flag without a packet", async (t) => {
    const extracting = {
      ...epic,
      download: {
        status: "complete",
        progress: 1,
        extracting: true,
      } as Download,
    };
    const state = await fixture(t, [extracting]);
    assert.equal(isLibraryGameDownloading(state.details.downloadGame), true);
    const completed = {
      ...extracting,
      download: { ...extracting.download, extracting: false },
    };

    await state.updateLibrary([completed], null);

    assert.equal(state.details.game, extracting);
    assert.equal(state.details.downloadGame?.download, completed.download);
    assert.equal(isLibraryGameDownloading(state.details.downloadGame), false);
    assert.equal(extracting.download.extracting, true);
  });

  it("updates the Epic download independently while Steam remains operational", async (t) => {
    const steam = {
      ...epic,
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      executablePath: "steam.exe",
      hasActiveEpicImport: false,
      download: null,
    } as LibraryGame;
    const downloading = {
      ...epic,
      executablePath: null,
      download: { status: "active", progress: 0.25 } as Download,
    };
    const state = await fixture(t, [steam, downloading]);
    assert.equal(state.details.game, steam);
    assert.equal(state.details.downloadGame, downloading);
    const paused = {
      ...downloading,
      download: { ...downloading.download, status: "paused" as const },
    };

    await state.updateLibrary([steam, paused], null);

    assert.equal(state.details.game, steam);
    assert.equal(state.details.downloadGame, paused);
    assert.equal(isLibraryGameDownloading(state.details.downloadGame), false);
    const resumed = {
      ...paused,
      download: { ...paused.download, status: "active" as const },
    };

    await state.updateLibrary([steam, resumed], null);

    assert.equal(state.details.game, steam);
    assert.equal(state.details.downloadGame, resumed);
    assert.equal(isLibraryGameDownloading(state.details.downloadGame), true);
  });

  it("selects the newly active member without reviving the operational member's stale active download", async (t) => {
    const steam = {
      ...epic,
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      executablePath: "steam.exe",
      hasActiveEpicImport: false,
      download: { status: "active", progress: 0.25 } as Download,
    } as LibraryGame;
    const pausedEpic = {
      ...epic,
      executablePath: null,
      download: { status: "paused", progress: 0.5 } as Download,
    };
    const state = await fixture(t, [steam, pausedEpic]);
    assert.equal(state.details.game, steam);
    assert.equal(state.details.downloadGame?.id, steam.id);
    const pausedSteam = {
      ...steam,
      download: { ...steam.download!, status: "paused" as const },
    };
    const activeEpic = {
      ...pausedEpic,
      download: { ...pausedEpic.download, status: "active" as const },
    };

    await state.updateLibrary([pausedSteam, activeEpic], null);

    assert.equal(state.details.game, steam);
    assert.equal(state.details.game?.download?.status, "active");
    assert.equal(state.details.presentation?.operationalGame.id, steam.id);
    assert.equal(
      state.details.presentation?.operationalGame.download?.status,
      "paused"
    );
    assert.equal(state.details.downloadGame, activeEpic);
    assert.equal(steam.download?.status, "active");
  });

  for (const executablePath of [null, "steam.exe"]) {
    it(`uses the Epic download while keeping Steam operational (executable=${executablePath})`, async (t) => {
      const steam = {
        ...epic,
        id: "steam:123",
        shop: "steam",
        objectId: "123",
        executablePath,
        hasActiveEpicImport: false,
      } as LibraryGame;
      const downloading = {
        ...epic,
        executablePath: null,
        download: { status: "active", progress: 0.25 } as Download,
      };
      const state = await fixture(t, [steam, downloading]);
      assert.equal(state.details.game, steam);
      assert.equal(state.details.shop, "steam");
      assert.equal(state.details.downloadGame, downloading);
      assert.equal(state.details.downloadGame?.shop, "epic");
      assert.equal(state.details.downloadGame?.objectId, epic.objectId);
      assert.equal(state.details.downloadGame?.download?.status, "active");
    });
  }

  it("uses Steam metadata and an Epic-only owned record without creating a Steam entry", async (t) => {
    const state = await fixture(t, [epic]);
    assert.equal(state.details.game, epic);
    assert.equal(state.details.shop, "epic");
    assert.equal(state.details.objectId, epic.objectId);
    assert.deepEqual(state.details.catalogueGame, {
      shop: "steam",
      objectId: "123",
    });
    assert.equal(state.details.game?.playTimeInMilliseconds, 1000);
    assert.equal(
      getDisplayedPlayTimeInMilliseconds(state.details.presentation!),
      4000
    );
    for (const action of ["details", "assets"]) {
      assert.ok(
        state.calls.some(
          ([name, shop, id]) =>
            name === action && shop === "steam" && id === "123"
        )
      );
    }
    for (const action of [
      "game",
      "achievements",
      "achievement-listener",
      "sync",
    ]) {
      assert.ok(
        state.calls.some(
          ([name, shop, id]) =>
            name === action && shop === "epic" && id === epic.objectId
        ),
        `${action} must target the real Epic record`
      );
    }
    assert.equal(
      state.calls.some(
        ([action, shop]) => action === "game" && shop === "steam"
      ),
      false
    );
    assert.equal(epic.playTimeInMilliseconds, 1000);
  });

  it("sums both owned copies only for reading while the operational game stays raw", async (t) => {
    const steam = {
      ...epic,
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      executablePath: null,
      hasActiveEpicImport: false,
      hasActiveSteamImport: true,
      playTimeInMilliseconds: 2000,
      epicPlayTimeInMilliseconds: 0,
      steamPlayTimeInMilliseconds: 5000,
    } as LibraryGame;
    const state = await fixture(t, [epic, steam], epic.id);
    assert.equal(state.details.game, epic);
    assert.equal(state.details.game?.playTimeInMilliseconds, 1000);
    assert.equal(state.details.presentation?.playTimeInMilliseconds, 3000);
    assert.equal(
      getDisplayedPlayTimeInMilliseconds(state.details.presentation!),
      11000
    );
    assert.equal(epic.playTimeInMilliseconds, 1000);
    assert.equal(steam.playTimeInMilliseconds, 2000);
    assert.ok(
      state.calls.some(
        ([action, shop, id]) =>
          action === "sync" && shop === "epic" && id === epic.objectId
      )
    );
    assert.ok(
      state.calls.some(
        ([action, shop, id]) =>
          action === "sync" && shop === "steam" && id === "123"
      )
    );
    assert.equal(
      state.calls.filter(
        ([action, shop]) => action === "sync" && shop === "epic"
      ).length,
      1
    );
    assert.equal(
      state.calls.filter(
        ([action, shop]) => action === "sync" && shop === "steam"
      ).length,
      1
    );
  });
});
