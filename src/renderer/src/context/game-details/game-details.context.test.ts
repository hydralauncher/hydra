import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type {
  Download,
  DownloadProgress,
  EpicCloudSaveState,
  GameArtworkOptions,
  GameShop,
  GameStats,
  LibraryGame,
  ShopAssets,
  UserAchievement,
} from "@types";
import type { GameDetailsContext } from "./game-details.context.types";
import {
  findLibraryGamePresentation,
  isLibraryGameDownloading,
  mergeLibraryCatalogueMetadata,
} from "../../../../shared/library-catalogue.js";
import { getDisplayedPlayTimeInMilliseconds } from "../../../../shared/playtime.js";
import { selectLibraryPresentationIndex } from "../../features/library-presentation.js";

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

interface ExecutableDialogOptions {
  defaultPath?: string;
  properties?: string[];
}

interface AssetsRequest {
  source: "details" | "assets";
  shop: GameShop;
  objectId: string;
  options?: GameArtworkOptions;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function fixture(
  t: TestContext,
  games: LibraryGame[],
  runningId?: string,
  initialLastPacket: DownloadProgress | null = null,
  artworkAssets?: (
    request: AssetsRequest
  ) => Partial<ShopAssets> | null | Promise<Partial<ShopAssets> | null>,
  getStats: () => Promise<GameStats | null> = async () => null,
  lockAchievementIdentity = false
) {
  let libraryGames = games;
  let lastPacket = initialLastPacket;
  let runningGameId = runningId;
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
  const libraryBatchListeners = new Set<() => void>();
  const achievementListeners = new Map<
    string,
    (rows: UserAchievement[]) => void
  >();
  const resolveAssets = async (request: AssetsRequest) =>
    artworkAssets
      ? artworkAssets(request)
      : request.source === "assets"
        ? { title: "Steam assets" }
        : {};
  const bridge = {
    getGameByObjectId: async (shop: string, objectId: string) => {
      calls.push(["game", shop, objectId]);
      return (
        games.find(
          (game) => game.shop === shop && game.objectId === objectId
        ) ?? null
      );
    },
    getGameShopDetails: async (
      objectId: string,
      shop: GameShop,
      language: string,
      options?: GameArtworkOptions
    ) => {
      calls.push(["details", shop, objectId, language, options]);
      return {
        name: "Steam metadata",
        content_descriptors: { ids: [] },
        assets: await resolveAssets({
          source: "details",
          shop,
          objectId,
          options,
        }),
      };
    },
    getGameAssets: async (
      objectId: string,
      shop: GameShop,
      options?: GameArtworkOptions
    ) => {
      calls.push(["assets", shop, objectId, options]);
      return resolveAssets({ source: "assets", shop, objectId, options });
    },
    cancelGameTransfer: async (shop: string, objectId: string) => {
      calls.push(["cancel-transfer", shop, objectId]);
    },
    getGameStats: getStats,
    getDefaultDownloadsPath: async () => "downloads",
    showOpenDialog: async (_options: ExecutableDialogOptions) => ({
      filePaths: [] as string[],
    }),
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
    onUpdateAchievements: (
      objectId: string,
      shop: string,
      listener: (rows: UserAchievement[]) => void
    ) => {
      calls.push(["achievement-listener", shop, objectId]);
      const key = `${shop}:${objectId}`;
      achievementListeners.set(key, listener);
      return () => achievementListeners.delete(key);
    },
    onGamesRunning: () => unsubscribe,
    onLibraryBatchComplete: (listener: () => void) => {
      libraryBatchListeners.add(listener);
      return () => libraryBatchListeners.delete(listener);
    },
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
            library: { downloadLibrary: libraryGames },
            gameRunning: {
              gameRunning: runningGameId ? { id: runningGameId } : null,
            },
          }),
      },
      "../features/library-presentation": { selectLibraryPresentationIndex },
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
          {
            shop: "steam",
            objectId: "123",
            gameTitle: "Steam title",
            lockAchievementIdentity,
          },
          React.createElement(Probe)
        )
      );
    });
  await render();
  return {
    calls,
    bridge,
    async updateLibrary(
      updatedGames: LibraryGame[],
      updatedLastPacket: DownloadProgress | null = lastPacket
    ) {
      libraryGames = updatedGames;
      lastPacket = updatedLastPacket;
      await render();
    },
    async setRunningGame(id?: string) {
      runningGameId = id;
      await render();
    },
    async completeLibraryBatch() {
      await React.act(async () => {
        for (const listener of libraryBatchListeners) listener();
      });
    },
    async emitAchievements(
      shop: string,
      objectId: string,
      rows: UserAchievement[]
    ) {
      await React.act(async () => {
        achievementListeners.get(`${shop}:${objectId}`)?.(rows);
      });
    },
    get details() {
      return current;
    },
  };
}

describe("Desktop catalogue page", () => {
  for (const locked of [false, true]) {
    it(`locked=${locked}: ignores another copy's source-only fallback but accepts combined and operational updates`, async (t) => {
      const steam = {
        ...epic,
        id: "steam:123",
        shop: "steam",
        objectId: "123",
        executablePath: "steam.exe",
        hasActiveEpicImport: false,
      } as LibraryGame;
      const state = await fixture(
        t,
        [steam, epic],
        undefined,
        null,
        undefined,
        undefined,
        locked
      );
      const operational = [
        { name: "steam-only", unlocked: true },
      ] as UserAchievement[];
      await state.emitAchievements("steam", "123", operational);
      assert.deepEqual(state.details.achievements, operational);
      await state.emitAchievements("epic", epic.objectId, [
        { name: "epic-only", unlocked: true },
      ] as UserAchievement[]);
      assert.deepEqual(state.details.achievements, operational);
      const combined = [
        {
          name: "combined",
          canonicalAchievementId: "identity",
          unlocked: true,
        },
      ] as UserAchievement[];
      await state.emitAchievements("epic", epic.objectId, combined);
      assert.deepEqual(state.details.achievements, combined);
    });
  }
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

  it("keeps Download disabled while extracting until the live library clears its flag without a packet", async (t) => {
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

async function epicCloudSettingsFixture(t: TestContext) {
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
  const game = {
    ...epic,
    epicInstallation: {
      artifactId: "artifact",
      platform: "Windows",
      owner: {
        environment: "staging",
        userId: "owner",
        epicAccountId: "account",
      },
    },
  } as LibraryGame;
  const state: EpicCloudSaveState = {
    epicObjectId: game.objectId,
    status: "up-to-date",
    supportsCloudSaves: true,
    automaticSync: true,
    savePath: "C:\\Saves\\Epic",
    pendingUpload: false,
    remoteManifest: "manifest",
  };
  const calls: [string, ...unknown[]][] = [];
  const hookGames: (LibraryGame | null)[] = [];
  const cloud = {
    available: true,
    state: null as EpicCloudSaveState | null,
    busy: false,
    failure: false,
    loading: true,
    readError: false,
    refresh: async () => {
      calls.push(["refresh", game.objectId]);
    },
    updateSettings: async (
      automaticSync: boolean,
      savePath?: string | null
    ) => {
      calls.push(["settings", game.objectId, automaticSync, savePath]);
    },
    choosePath: async () => {
      calls.push(["choosePath", game.objectId]);
    },
    sync: async () => {
      calls.push(["sync", game.objectId]);
    },
    resolve: async (choice: "local" | "remote") => {
      calls.push(["resolve", game.objectId, choice]);
    },
  };
  const icon = () => React.createElement("span", { "aria-hidden": true });
  const Section = loadModule(
    "src/renderer/src/pages/game-details/modals/game-options-modal/epic-cloud-section.tsx",
    {
      "react-i18next": {
        useTranslation: () => ({ t: (key: string) => key }),
      },
      "react-loading-skeleton": () =>
        React.createElement("span", { "data-skeleton": true }),
      "@phosphor-icons/react": {
        ArrowClockwiseIcon: icon,
        CircleNotchIcon: icon,
        CloudIcon: icon,
        FolderOpenIcon: icon,
      },
      "@renderer/components": {
        Button: ({
          theme: _theme,
          ...props
        }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
          theme?: string;
        }) => React.createElement("button", props),
        Link: ({
          to,
          ...props
        }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
          to: string;
        }) => React.createElement("a", { ...props, href: to }),
        TextField: ({
          label,
          rightContent,
          ...props
        }: React.InputHTMLAttributes<HTMLInputElement> & {
          label?: string;
          rightContent?: React.ReactNode;
        }) =>
          React.createElement(
            "label",
            null,
            label,
            React.createElement("input", props),
            rightContent
          ),
      },
      "@renderer/hooks": {
        useDate: () => ({
          formatDateTime: (date: string) => `formatted:${date}`,
        }),
      },
      "@renderer/hooks/use-epic-cloud-save-controls": {
        useEpicCloudSaveControls: (input: LibraryGame | null) => {
          hookGames.push(input);
          return cloud;
        },
      },
      "@renderer/helpers/epic-managed-error": {
        getEpicManagedError: (error: string) => ({
          key: `error:${error}`,
          ns: "game_details",
        }),
      },
      "../../cloud-save-v2/cloud-save-status-icon": {
        CloudSaveStatusIcon: icon,
      },
      "../../cloud-save-v2/cloud-save-v2.scss": {},
      "./epic-cloud-section.scss": {},
    }
  ).EpicCloudSettingsSection as React.ElementType;
  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const render = async (isGameRunning = false) => {
    await React.act(async () => {
      root.render(React.createElement(Section, { game, isGameRunning }));
    });
  };
  const button = (key: string) => {
    const found = [...dom.window.document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === key
    );
    assert.ok(found, `button ${key} must be visible`);
    return found;
  };
  const click = async (target: HTMLButtonElement) => {
    await React.act(async () => target.click());
  };
  await render();
  return { dom, game, state, cloud, calls, hookGames, render, button, click };
}

describe("Desktop Epic cloud settings", () => {
  it("shows loading, retries read errors and controls the real Epic record", async (t) => {
    const view = await epicCloudSettingsFixture(t);
    const document = view.dom.window.document;
    assert.equal(document.querySelectorAll("[data-skeleton]").length, 2);
    assert.equal(document.querySelector("[role=switch]"), null);
    assert.equal(document.querySelector("input"), null);
    assert.equal(view.calls.length, 0);

    Object.assign(view.cloud, { loading: false, readError: true });
    await view.render();
    assert.equal(document.querySelectorAll("[data-skeleton]").length, 0);
    assert.match(
      document.querySelector("[role=alert]")!.textContent!,
      /network/
    );
    assert.equal(
      document.querySelector("[role=status]")!.textContent,
      "epic_save_status_unavailable"
    );
    assert.equal(
      document.querySelector("a")?.getAttribute("href"),
      "/settings?tab=integrations"
    );
    await view.click(view.button("epic_retry"));
    assert.deepEqual(view.calls, [["refresh", epic.objectId]]);

    view.cloud.state = view.state;
    await view.render();
    assert.equal(
      document.querySelector("[role=status]")!.textContent,
      "epic_save_status_unavailable"
    );
    assert.equal(view.button("epic_save_sync_now").disabled, true);

    Object.assign(view.cloud, { state: view.state, readError: false });
    await view.render();
    assert.equal(document.querySelector("input")!.value, view.state.savePath);
    assert.equal(document.querySelector("input")!.readOnly, true);
    assert.equal(
      document.querySelector("[role=status]")!.textContent,
      "epic_save_status_up-to-date"
    );
    await view.click(
      document.querySelector<HTMLButtonElement>("[role=switch]")!
    );
    await view.click(view.button("epic_save_select_path"));
    await view.click(view.button("epic_save_sync_now"));
    assert.deepEqual(view.calls.slice(1), [
      ["settings", epic.objectId, false, undefined],
      ["choosePath", epic.objectId],
      ["sync", epic.objectId],
    ]);
    view.cloud.state = {
      ...view.state,
      status: "unavailable",
      error: "save-sync-failed",
    };
    await view.render();
    assert.equal(view.button("epic_retry").disabled, false);
    await view.click(view.button("epic_retry"));
    assert.deepEqual(view.calls.at(-1), ["sync", epic.objectId]);
    const completedCalls = view.calls.length;
    for (const blockedBy of ["running", "busy", "loading"] as const) {
      view.cloud.busy = blockedBy === "busy";
      view.cloud.loading = blockedBy === "loading";
      await view.render(blockedBy === "running");
      assert.equal(view.button("epic_retry").disabled, true, blockedBy);
      await view.click(view.button("epic_retry"));
      assert.equal(view.calls.length, completedCalls);
    }
    assert.ok(view.hookGames.every((game) => game === view.game));
    assert.equal(view.game.catalogueGame?.shop, "steam");
  });

  it("blocks unsafe actions and permits choosing a required save folder", async (t) => {
    const view = await epicCloudSettingsFixture(t);
    view.cloud.state = view.state;
    view.cloud.loading = false;
    for (const blockedBy of ["running", "busy", "unavailable"] as const) {
      view.cloud.busy = blockedBy === "busy";
      view.cloud.available = blockedBy !== "unavailable";
      await view.render(blockedBy === "running");
      const controls = [
        view.dom.window.document.querySelector<HTMLButtonElement>(
          "[role=switch]"
        )!,
        view.button("epic_save_select_path"),
        view.button(
          blockedBy === "busy"
            ? "epic_save_status_syncing"
            : "epic_save_sync_now"
        ),
      ];
      for (const control of controls) {
        assert.equal(control.disabled, true, blockedBy);
        await view.click(control);
      }
      assert.equal(view.calls.length, 0);
    }
    view.cloud.busy = false;
    view.cloud.available = true;
    for (const error of ["save-path-required", "invalid-path"] as const) {
      view.cloud.state = {
        ...view.state,
        status: "unavailable",
        error,
        savePath: error === "save-path-required" ? null : "C:\\Invalid",
      };
      await view.render();
      assert.equal(view.button("epic_save_sync_now").disabled, true, error);
      assert.equal(view.button("epic_save_select_path").disabled, false, error);
      await view.click(view.button("epic_save_select_path"));
      await view.click(view.button("epic_save_sync_now"));
    }
    assert.deepEqual(view.calls, [
      ["choosePath", epic.objectId],
      ["choosePath", epic.objectId],
    ]);
  });

  it("keeps recovery settings available after a save check fails", async (t) => {
    const view = await epicCloudSettingsFixture(t);
    view.cloud.loading = false;
    for (const error of ["network", "save-sync-failed"] as const) {
      view.cloud.state = { ...view.state, status: "unavailable", error };
      await view.render();
      const toggle =
        view.dom.window.document.querySelector<HTMLButtonElement>(
          "[role=switch]"
        )!;
      assert.equal(toggle.disabled, false, error);
      assert.equal(view.button("epic_save_select_path").disabled, false, error);
      assert.equal(view.button("epic_save_sync_now").disabled, true, error);
      await view.click(toggle);
      await view.click(view.button("epic_save_select_path"));
    }
    assert.deepEqual(
      view.calls.map(([action]) => action),
      ["settings", "choosePath", "settings", "choosePath"]
    );
  });

  it("explains unsupported saves and resolves dated local/remote conflict cards", async (t) => {
    const view = await epicCloudSettingsFixture(t);
    Object.assign(view.cloud, {
      loading: false,
      state: {
        ...view.state,
        status: "unavailable",
        supportsCloudSaves: false,
        error: "saves-unsupported",
      },
    });
    await view.render();
    const document = view.dom.window.document;
    assert.equal(document.querySelector("[role=switch]"), null);
    assert.equal(document.querySelector("input"), null);
    assert.equal(document.querySelectorAll("button").length, 0);
    assert.match(document.body.textContent!, /epic_save_unsupported/);

    view.cloud.state = {
      ...view.state,
      status: "conflict",
      error: "save-conflict",
      localModifiedAt: "2026-10-14T12:00:00Z",
      remoteModifiedAt: "2026-10-14T11:00:00Z",
    };
    await view.render();
    const cards = document.querySelectorAll(
      ".epic-cloud-settings__conflict-copy"
    );
    assert.equal(cards.length, 2);
    assert.match(cards[0]!.textContent!, /formatted:2026-10-14T12:00:00Z/);
    assert.match(cards[1]!.textContent!, /formatted:2026-10-14T11:00:00Z/);
    await view.click(view.button("epic_save_use_local"));
    await view.click(view.button("epic_save_use_remote"));
    assert.deepEqual(view.calls, [
      ["resolve", epic.objectId, "local"],
      ["resolve", epic.objectId, "remote"],
    ]);
    await view.render(true);
    for (const key of ["epic_save_use_local", "epic_save_use_remote"]) {
      assert.equal(view.button(key).disabled, true);
      await view.click(view.button(key));
    }
    assert.equal(view.calls.length, 2);
  });
});

describe("Desktop selected artwork", () => {
  const defaults: ShopAssets = {
    shop: "steam",
    objectId: "123",
    title: "Steam assets",
    iconUrl: "https://steam.test/icon.png",
    libraryHeroImageUrl: "https://steam.test/hero.png",
    libraryImageUrl: "https://steam.test/grid.png",
    logoImageUrl: "https://steam.test/logo.png",
    logoPosition: null,
    coverImageUrl: "https://steam.test/cover.png",
    downloadSources: [],
  };
  const selected: ShopAssets = {
    ...defaults,
    libraryHeroImageUrl: "https://artwork.test/epic-hero.png",
    logoImageUrl: "https://artwork.test/epic-logo.png",
    selectedArtworkTypes: ["hero", "logo"],
  };

  it("renders the Epic record's selected artwork while both getters still request Steam catalogue data", async (t) => {
    const state = await fixture(t, [epic], undefined, null, ({ options }) =>
      options?.artworkIdentity?.shop === "epic" &&
      options.artworkIdentity.objectId === epic.objectId
        ? selected
        : defaults
    );

    assert.equal(state.details.shopDetails?.name, "Steam metadata");
    assert.deepEqual(state.details.shopDetails?.assets, selected);
    for (const source of ["details", "assets"]) {
      const requests = state.calls.filter(([action]) => action === source);
      assert.ok(requests.length > 0);
      for (const request of requests) {
        assert.equal(request[1], "steam");
        assert.equal(request[2], "123");
        assert.deepEqual(request[source === "details" ? 4 : 3], {
          artworkIdentity: { shop: "epic", objectId: epic.objectId },
        });
      }
    }
  });

  it("refreshes selected artwork and clears individual selections on library batch events", async (t) => {
    let response = selected;
    const state = await fixture(t, [epic], undefined, null, ({ options }) =>
      options?.artworkIdentity?.shop === "epic" ? response : defaults
    );
    assert.deepEqual(state.details.shopDetails?.assets, selected);
    response = {
      ...selected,
      libraryHeroImageUrl: "https://artwork.test/updated-hero.png",
    };

    await state.completeLibraryBatch();

    assert.deepEqual(state.details.shopDetails?.assets, response);
    response = {
      ...defaults,
      logoImageUrl: selected.logoImageUrl,
      selectedArtworkTypes: ["logo"],
    };

    await state.completeLibraryBatch();

    assert.equal(
      state.details.shopDetails?.assets?.libraryHeroImageUrl,
      defaults.libraryHeroImageUrl
    );
    assert.equal(
      state.details.shopDetails?.assets?.logoImageUrl,
      selected.logoImageUrl
    );
    assert.deepEqual(state.details.shopDetails?.assets, response);
    response = defaults;

    await state.completeLibraryBatch();

    assert.deepEqual(state.details.shopDetails?.assets, defaults);
    assert.equal(state.details.game, epic);
    assert.equal(epic.customHeroImageUrl, undefined);
  });

  it("ignores late Epic details and assets after the operational member changes to Steam", async (t) => {
    const steam = {
      ...epic,
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      executablePath: "steam.exe",
      hasActiveEpicImport: false,
    } as LibraryGame;
    const pendingDetails = deferred<ShopAssets>();
    const pendingAssets = deferred<ShopAssets>();
    const state = await fixture(
      t,
      [epic, steam],
      epic.id,
      null,
      ({ source, options }) => {
        if (options?.artworkIdentity?.shop === "epic") {
          return source === "details"
            ? pendingDetails.promise
            : pendingAssets.promise;
        }
        return defaults;
      }
    );
    assert.equal(state.details.shop, "epic");
    const pendingShopDetails = state.details.shopDetails;
    assert.equal(pendingShopDetails, null);

    await state.setRunningGame(steam.id);

    assert.equal(state.details.shop, "steam");
    assert.deepEqual(state.details.shopDetails?.assets, defaults);
    for (const source of ["details", "assets"]) {
      const request = state.calls.findLast(([action]) => action === source)!;
      assert.equal(request[1], "steam");
      assert.equal(request[2], "123");
      assert.deepEqual(request[source === "details" ? 4 : 3], {
        artworkIdentity: { shop: "steam", objectId: "123" },
      });
    }

    await React.act(async () => pendingDetails.resolve(selected));

    assert.deepEqual(state.details.shopDetails?.assets, defaults);

    await React.act(async () => pendingAssets.resolve(selected));

    assert.deepEqual(state.details.shopDetails?.assets, defaults);
    assert.equal(state.details.game, steam);
  });
});

describe("Desktop asynchronous requests", () => {
  it("clears unavailable stats without rejecting the page refresh", async (t) => {
    const stats = { downloadCount: 5 } as GameStats;
    let failStats = false;
    const state = await fixture(
      t,
      [epic],
      undefined,
      null,
      undefined,
      async () => {
        if (failStats) throw new Error("stats unavailable");
        return stats;
      }
    );
    assert.equal(state.details.stats, stats);

    failStats = true;
    await state.completeLibraryBatch();

    assert.equal(state.details.stats, null);
    assert.equal(state.details.isLoading, false);
    assert.ok(state.details.shopDetails);
  });

  it("ignores a stats rejection from the previous operational identity", async (t) => {
    const oldStats = deferred<GameStats | null>();
    const freshStats = { downloadCount: 10 } as GameStats;
    let firstRequest = true;
    const steam = {
      ...epic,
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      hasActiveEpicImport: false,
    } as LibraryGame;
    const state = await fixture(
      t,
      [epic, steam],
      epic.id,
      null,
      undefined,
      () => {
        if (firstRequest) {
          firstRequest = false;
          return oldStats.promise;
        }
        return Promise.resolve(freshStats);
      }
    );

    await state.setRunningGame(steam.id);
    assert.equal(state.details.stats, freshStats);
    await React.act(async () =>
      oldStats.reject(new Error("old request failed"))
    );
    assert.equal(state.details.stats, freshStats);
  });

  it("awaits executable selection, returns cancellation, and propagates dialog errors", async (t) => {
    const state = await fixture(t, [epic]);
    let dialogOptions: ExecutableDialogOptions | undefined;
    const pendingDialog = deferred<{ filePaths: string[] }>();
    state.bridge.showOpenDialog = async (options) => {
      dialogOptions = options;
      return pendingDialog.promise;
    };
    const selected = state.details.selectGameExecutable();
    await React.act(async () =>
      pendingDialog.resolve({ filePaths: ["game.exe"] })
    );
    assert.equal(await selected, "game.exe");
    assert.equal(dialogOptions?.defaultPath, "downloads");
    assert.deepEqual(dialogOptions?.properties, ["openFile"]);

    state.bridge.showOpenDialog = async () => ({ filePaths: [] });
    assert.equal(await state.details.selectGameExecutable(), null);
    const error = new Error("dialog unavailable");
    state.bridge.showOpenDialog = async () => {
      throw error;
    };
    await assert.rejects(state.details.selectGameExecutable(), error);
  });
});

it("handles a failed transfer cancellation for the operational copy", async (t) => {
  const state = await fixture(t, [epic]);
  const error = new Error("transfer cancellation failed");
  const originalError = console.error;
  const reported: unknown[][] = [];
  console.error = (...args: unknown[]) => reported.push(args);
  t.after(() => {
    console.error = originalError;
  });
  state.bridge.cancelGameTransfer = async (shop, objectId) => {
    assert.equal(shop, epic.shop);
    assert.equal(objectId, epic.objectId);
    throw error;
  };

  await React.act(async () => state.details.cancelTransfer());

  assert.deepEqual(reported, [["Failed to cancel game transfer:", error]]);
  assert.equal(state.details.isTransferring, false);
  assert.equal(state.details.transferProgress, 0);
  Reflect.deleteProperty(state.bridge, "cancelGameTransfer");
  await React.act(async () => state.details.cancelTransfer());
  assert.equal(reported.length, 1);
});
