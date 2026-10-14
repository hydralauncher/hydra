import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type { Download, EpicCloudSaveState, LibraryGame } from "@types";
import type { GameDetailsContext } from "./game-details.context.types";
import {
  findLibraryGamePresentation,
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
  runningId?: string
) {
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
      "./use-library": { useLibrary: () => ({ downloadLibrary: games }) },
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
      useDownload: () => ({ lastPacket: null }),
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
  await React.act(async () => {
    root.render(
      React.createElement(
        Provider,
        { shop: "steam", objectId: "123", gameTitle: "Steam title" },
        React.createElement(Probe)
      )
    );
  });
  return {
    calls,
    get details() {
      return current;
    },
  };
}

describe("Desktop catalogue page", () => {
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
