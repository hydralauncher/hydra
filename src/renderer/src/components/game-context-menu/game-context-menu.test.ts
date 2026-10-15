import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type { Download, LibraryGame } from "@types";
import type { GameContextMenuGame } from "./game-context-menu.types";
import {
  findLibraryGamePresentation,
  isLibraryGameDownloading,
  mergeLibraryCatalogueMetadata,
} from "../../../../shared/library-catalogue.js";
import { applyLibraryGroupAction } from "../../../../shared/library-group-actions.js";
import { selectLibraryPresentationIndex } from "../../features/library-presentation.js";

const requireModule = createRequire(import.meta.url);
const directory = "src/renderer/src/components/game-context-menu";

function loadModule(filename: string, stubs: Record<string, unknown>) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
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

const steam = {
  id: "steam:123",
  shop: "steam",
  objectId: "123",
  title: "Game",
  iconUrl: null,
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  remoteId: null,
  canonicalId: "canonical-game",
  catalogueGame: { shop: "steam", objectId: "123" },
  executablePath: "steam.exe",
  download: null,
  playTimeInMilliseconds: 0,
  lastTimePlayed: null,
  isDeleted: false,
  isConcealed: false,
  collectionIds: [],
} as LibraryGame;

const epicWithDownload = (download: Partial<Download>) =>
  ({
    ...steam,
    id: "epic:namespace:game",
    shop: "epic",
    objectId: "namespace:game",
    executablePath: null,
    download: {
      downloadPath: "epic-downloads",
      progress: 0.25,
      extracting: false,
      ...download,
    },
  }) as LibraryGame;

interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  submenu?: MenuItem[];
  onClick?: () => unknown;
}

interface MenuActions {
  downloadGame: GameContextMenuGame;
  isGameDownloading: boolean;
  isDeleting: boolean;
  isDownloadDeleting: boolean;
  handleRemoveFiles: () => Promise<void>;
  handleOpenGameOptions: () => void;
}

async function fixture(
  t: TestContext,
  initialLibrary: LibraryGame[],
  requestedGame: GameContextMenuGame = steam
) {
  let library = initialLibrary;
  let deletingIds = new Set<string>();
  let refreshWait: Promise<void> | null = null;
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://hydra.test/library",
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
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

  const calls: [string, ...unknown[]][] = [];
  const removedEvents: unknown[] = [];
  dom.window.addEventListener("hydra:game-files-removed", (event) => {
    removedEvents.push((event as CustomEvent).detail);
  });
  const bridge = {
    platform: "linux",
    onGamesRunning: () => () => {},
    openGame: async (...args: unknown[]) => {
      calls.push(["play", ...args]);
    },
    closeGame: async (...args: unknown[]) => {
      calls.push(["close", ...args]);
    },
    openGameExecutablePath: async (...args: unknown[]) => {
      calls.push(["executable-folder", ...args]);
    },
    openGameInstallerPath: async (...args: unknown[]) => {
      calls.push(["download-folder", ...args]);
    },
    createGameShortcut: async (...args: unknown[]) => {
      calls.push(["shortcut", ...args]);
      return true;
    },
    createSteamShortcut: async (...args: unknown[]) => {
      calls.push(["steam-shortcut", ...args]);
    },
  };
  Object.assign(dom.window, { electron: bridge });
  const updateLibrary = async () => {
    calls.push(["refresh"]);
    await refreshWait;
  };
  const loadCollections = async () => {};
  const hooks: Record<string, unknown> = {
    useLibrary: () => ({ library, downloadLibrary: library, updateLibrary }),
    useDownload: () => ({
      lastPacket: null,
      isGameDeleting: (objectId: string) => deletingIds.has(objectId),
      removeGameInstaller: async (shop: string, objectId: string) => {
        calls.push(["remove-installer", shop, objectId]);
      },
      removeGameFromLibrary: async () => {},
    }),
    useGameCollections: () => ({
      collections: [],
      isLoading: false,
      loadCollections,
      assignGameToCollection: async () => {},
    }),
    useToast: () => ({
      showSuccessToast: (...args: unknown[]) =>
        calls.push(["success", ...args]),
      showErrorToast: (...args: unknown[]) => calls.push(["error", ...args]),
    }),
    useUserDetails: () => ({ userDetails: null }),
  };
  const shared = {
    findLibraryGamePresentation,
    mergeLibraryCatalogueMetadata,
    isLibraryGameDownloading,
    applyLibraryGroupAction,
  };
  const presentation = loadModule(
    "src/renderer/src/hooks/use-library-game-presentation.ts",
    {
      "@shared": shared,
      "./use-library": { useLibrary: hooks.useLibrary },
      "../features/library-presentation": { selectLibraryPresentationIndex },
      "./redux": {
        useAppSelector: (select: (state: unknown) => unknown) =>
          select({
            library: { downloadLibrary: library },
            gameRunning: { gameRunning: null },
          }),
      },
    }
  );
  hooks.useLibraryGamePresentation = presentation.useLibraryGamePresentation;
  const navigate = (...args: unknown[]) => calls.push(["navigate", ...args]);
  const router = {
    useNavigate: () => navigate,
    useLocation: () => ({ pathname: "/library" }),
    useSearchParams: () => [new URLSearchParams()],
  };
  const translate = (key: string) => key;
  const translation = { useTranslation: () => ({ t: translate }) };
  const helpers = {
    buildGameDetailsPath: (game: GameContextMenuGame) =>
      `/game/${game.shop}/${game.objectId}`,
    handleClassicsLaunchError: () => false,
    getGameCollectionIds: (game: GameContextMenuGame) =>
      game.collectionIds ?? [],
  };
  const actionsModule = loadModule(`${directory}/use-game-actions.ts`, {
    "@renderer/hooks": hooks,
    "react-i18next": translation,
    "react-router-dom": router,
    "@renderer/helpers": helpers,
    "@renderer/logger": { logger: { error: () => {} } },
    "@renderer/context/game-options-modal/game-options-modal.context": {
      useGameOptionsModal: () => ({
        openGameOptionsModal: (...args: unknown[]) =>
          calls.push(["options", ...args]),
      }),
    },
    "@shared": shared,
  });
  const useActions = actionsModule.useGameActions as (
    game: GameContextMenuGame
  ) => MenuActions;
  let currentActions!: MenuActions;
  let items: MenuItem[] = [];
  let confirmation!: { visible: boolean; deleteGame: () => void };
  const stubComponent = () => null;
  const menuModule = loadModule(`${directory}/game-context-menu.tsx`, {
    "react-i18next": translation,
    "react-router-dom": router,
    "@shared": { ...shared, AuthPage: {} },
    "@primer/octicons-react": new Proxy({}, { get: () => stubComponent }),
    "@renderer/assets/steam-logo.svg?react": stubComponent,
    "..": {
      ContextMenu: (props: { items: MenuItem[] }) => {
        items = props.items;
        return null;
      },
      useGameActions: (game: GameContextMenuGame) => {
        currentActions = useActions(game);
        return currentActions;
      },
      ConfirmationModal: stubComponent,
      CreateCollectionModal: stubComponent,
    },
    "@renderer/hooks": hooks,
    "@renderer/context": {
      useCollectionContextMenu: () => ({
        isCollectionContextMenuOrModalOpen: false,
      }),
    },
    "@renderer/helpers": helpers,
    "@renderer/pages/game-details/modals/remove-from-library-modal": {
      RemoveGameFromLibraryModal: stubComponent,
    },
    "@renderer/pages/downloads/delete-game-modal": {
      DeleteGameModal: (props: typeof confirmation) => {
        confirmation = props;
        return null;
      },
    },
  });
  const Menu = menuModule.GameContextMenu as React.ElementType;
  const root = createRoot(dom.window.document.getElementById("root")!);
  const onClose = () => calls.push(["close-menu"]);
  const render = () =>
    React.act(async () => {
      root.render(
        React.createElement(Menu, {
          game: requestedGame,
          visible: true,
          position: { x: 0, y: 0 },
          onClose,
        })
      );
    });
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await render();
  const findItem = (id: string): MenuItem | undefined => {
    const visit = (entries: MenuItem[]): MenuItem | undefined => {
      for (const item of entries) {
        if (item.id === id) return item;
        const child = item.submenu && visit(item.submenu);
        if (child) return child;
      }
      return undefined;
    };
    return visit(items);
  };
  const item = (id: string) => {
    const found = findItem(id);
    assert.ok(found, `menu item ${id} must exist`);
    return found;
  };
  return {
    calls,
    removedEvents,
    item,
    get actions() {
      return currentActions;
    },
    get confirmationVisible() {
      return confirmation.visible;
    },
    async click(id: string) {
      const target = item(id);
      assert.equal(Boolean(target.disabled), false, `${id} must be enabled`);
      await React.act(async () => {
        await target.onClick?.();
      });
    },
    async confirmRemoval() {
      assert.equal(confirmation.visible, true);
      await React.act(async () => confirmation.deleteGame());
    },
    async updateLibrary(games: LibraryGame[]) {
      library = games;
      await render();
    },
    async setDeleting(objectIds: string[]) {
      deletingIds = new Set(objectIds);
      await render();
    },
    waitForRefresh(promise: Promise<void>) {
      refreshWait = promise;
    },
  };
}

describe("context menu download identity", () => {
  it("keeps Steam launch actions separate from the active Epic download", async (t) => {
    const epic = epicWithDownload({ status: "active" });
    const state = await fixture(t, [steam, epic]);
    assert.equal(state.actions.isGameDownloading, true);
    assert.equal(state.actions.downloadGame.id, epic.id);
    assert.equal(state.item("play").disabled, false);
    assert.equal(state.item("download-options").disabled, true);
    assert.equal(state.item("remove-files").disabled, true);
    await state.click("download-location");
    await state.click("play");
    await state.click("open-folder");
    await state.click("desktop-shortcut");
    await state.click("steam-shortcut");
    await state.click("properties");
    await state.actions.handleRemoveFiles();
    assert.deepEqual(
      state.calls.find(([action]) => action === "download-folder"),
      ["download-folder", "epic", epic.objectId]
    );
    for (const action of [
      "play",
      "executable-folder",
      "shortcut",
      "steam-shortcut",
    ])
      assert.equal(state.calls.find(([name]) => name === action)?.[1], "steam");
    assert.equal(
      (state.calls.find(([name]) => name === "options")?.[1] as LibraryGame).id,
      steam.id
    );
    assert.equal(
      state.calls.some(([action]) => action === "remove-installer"),
      false
    );
  });

  it("removes only paused Epic files and reports the actual downloaded identity", async (t) => {
    const epic = epicWithDownload({ status: "paused" });
    const state = await fixture(t, [steam, epic]);
    assert.equal(state.item("remove-files").disabled, false);
    await state.click("remove-files");
    await state.confirmRemoval();
    assert.deepEqual(
      state.calls.filter(([action]) => action === "remove-installer"),
      [["remove-installer", "epic", epic.objectId]]
    );
    assert.deepEqual(state.removedEvents, [
      { shop: "epic", objectId: epic.objectId },
    ]);
  });

  for (const download of [
    { status: "active" },
    { status: "extracting" },
    { status: "complete", extracting: true },
  ] as Partial<Download>[]) {
    it(`blocks download and removal without a packet for ${JSON.stringify(download)}`, async (t) => {
      const uninstalledSteam = { ...steam, executablePath: null };
      const epic = epicWithDownload(download);
      const state = await fixture(
        t,
        [uninstalledSteam, epic],
        uninstalledSteam
      );
      assert.equal(state.actions.isGameDownloading, true);
      assert.equal(state.item("play").label, "download");
      assert.equal(state.item("play").disabled, true);
      assert.equal(state.item("remove-files").disabled, true);
      await state.actions.handleRemoveFiles();
      assert.equal(
        state.calls.some(([action]) => action === "remove-installer"),
        false
      );
    });
  }

  it("updates an open menu and protects an earlier confirmation after resuming", async (t) => {
    const active = epicWithDownload({ status: "active" });
    const state = await fixture(t, [steam, active]);
    assert.equal(state.item("remove-files").disabled, true);
    const paused = epicWithDownload({ status: "paused" });
    await state.updateLibrary([steam, paused]);
    assert.equal(state.actions.isGameDownloading, false);
    assert.equal(state.item("remove-files").disabled, false);
    await state.click("remove-files");
    assert.equal(state.confirmationVisible, true);
    await state.updateLibrary([steam, active]);
    assert.equal(state.actions.isGameDownloading, true);
    assert.equal(state.item("remove-files").disabled, true);
    await state.confirmRemoval();
    assert.equal(
      state.calls.some(([action]) => action === "remove-installer"),
      false
    );
  });

  it("blocks Epic download actions during deletion while Steam remains playable", async (t) => {
    const epic = epicWithDownload({ status: "paused" });
    const state = await fixture(t, [steam, epic]);
    await state.setDeleting([epic.objectId]);
    assert.equal(state.actions.isDownloadDeleting, true);
    assert.equal(state.actions.isDeleting, false);
    assert.equal(state.item("download-options").disabled, true);
    assert.equal(state.item("download-location").disabled, true);
    assert.equal(state.item("remove-files").disabled, true);
    assert.equal(state.item("play").disabled, false);
    await state.actions.handleRemoveFiles();
    assert.equal(
      state.calls.some(([action]) => action === "remove-installer"),
      false
    );
    await state.setDeleting([steam.objectId]);
    assert.equal(state.actions.isDeleting, true);
    assert.equal(state.item("play").disabled, true);
  });

  it("keeps download actions on an ungrouped requested game", async (t) => {
    const single: GameContextMenuGame = {
      id: "steam:456",
      shop: "steam",
      objectId: "456",
      title: "Single game",
      executablePath: "single.exe",
      download: { status: "paused", downloadPath: "single-downloads" },
    };
    const state = await fixture(t, [], single);
    assert.equal(state.actions.downloadGame, single);
    await state.click("play");
    await state.click("download-location");
    await state.click("remove-files");
    await state.confirmRemoval();
    assert.deepEqual(
      state.calls.filter(([action]) => action === "remove-installer"),
      [["remove-installer", "steam", single.objectId]]
    );
    assert.deepEqual(state.removedEvents, [
      { shop: "steam", objectId: single.objectId },
    ]);
  });

  it("waits for the refreshed library before announcing removed files", async (t) => {
    const epic = epicWithDownload({ status: "paused" });
    const state = await fixture(t, [steam, epic]);
    let resolveRefresh!: () => void;
    state.waitForRefresh(
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      })
    );
    let completed = false;
    const removal = state.actions.handleRemoveFiles().then(() => {
      completed = true;
    });
    await React.act(async () => {});
    assert.equal(
      state.calls.some(([action]) => action === "refresh"),
      true
    );
    assert.equal(completed, false);
    assert.deepEqual(state.removedEvents, []);
    await React.act(async () => {
      resolveRefresh();
      await removal;
    });
    assert.equal(completed, true);
    assert.deepEqual(state.removedEvents, [
      { shop: "epic", objectId: epic.objectId },
    ]);
  });
});
