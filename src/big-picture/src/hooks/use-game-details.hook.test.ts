import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import type {
  CatalogueGameIdentity,
  Download,
  GameArtworkOptions,
  GameArtworkSelection,
  LibraryGame,
  ShopAssets,
  ShopDetailsWithAssets,
} from "@types";
import { composeAssetsWithArtwork } from "../../../shared/artwork-resolver.js";
import { applyLibraryGroupAction } from "../../../shared/library-group-actions.js";
import { findLibraryGamePresentation } from "../../../shared/library-catalogue.js";

const requireModule = createRequire(import.meta.url);
const { act } = React;

function loadModule(filename: string, stubs: Record<string, unknown>) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  const exports: Record<string, unknown> = {};
  new Function("exports", "require", outputText)(
    exports,
    (name: string) => stubs[name] ?? requireModule(name)
  );
  return exports;
}

const imageHelpers = loadModule("src/big-picture/src/helpers/image.ts", {});
const preferredAssetsHelpers = loadModule(
  "src/big-picture/src/helpers/preferred-assets.ts",
  { "./image": imageHelpers }
);
const catalogueAssets: ShopAssets = {
  objectId: "123",
  shop: "steam",
  title: "Steam details",
  iconUrl: "https://steam.test/icon.png",
  logoImageUrl: "https://steam.test/logo.png",
  libraryHeroImageUrl: "https://steam.test/hero.png",
  libraryImageUrl: "https://steam.test/landscape.png",
  coverImageUrl: "https://steam.test/cover.png",
  logoPosition: null,
  downloadSources: [],
};

const artwork = (
  identity: CatalogueGameIdentity,
  selected: GameArtworkSelection["selected"]
): GameArtworkSelection => ({ ...identity, selected, updatedAt: 1 });
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
  freshGame?: LibraryGame,
  options: {
    selections?: GameArtworkSelection[];
    detailsAssets?: boolean;
    nullAssets?: boolean;
    deferAssetsFor?: string;
  } = {}
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
  const selections = new Map(
    (options.selections ?? []).map((selection) => [
      selection.shop + ":" + selection.objectId,
      selection,
    ])
  );
  const compose = (
    objectId: string,
    shop: string,
    requestOptions?: GameArtworkOptions
  ) => {
    const identity = requestOptions?.artworkIdentity ?? { objectId, shop };
    return composeAssetsWithArtwork(
      catalogueAssets,
      selections.get(identity.shop + ":" + identity.objectId)
    );
  };
  let libraryBatchHandler: (() => void) | null = null;
  let deferredOnce = false;
  let resolveDeferredAssets: (() => void) | null = null;
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
    getGameShopDetails: async (
      objectId: string,
      shop: string,
      _language: string,
      requestOptions?: GameArtworkOptions
    ) => {
      calls.push(["details", shop, objectId, requestOptions]);
      return options.detailsAssets
        ? {
            objectId,
            name: "Steam metadata",
            assets: compose(objectId, shop, requestOptions),
          }
        : null;
    },
    getGameStats: async () => null,
    getGameAssets: async (
      objectId: string,
      shop: string,
      requestOptions?: GameArtworkOptions
    ) => {
      calls.push(["assets", shop, objectId, requestOptions]);
      if (options.nullAssets) return null;
      const result = compose(objectId, shop, requestOptions);
      const identity = requestOptions?.artworkIdentity ?? { shop, objectId };
      if (
        !deferredOnce &&
        options.deferAssetsFor === identity.shop + ":" + identity.objectId
      ) {
        deferredOnce = true;
        return new Promise<ShopAssets>((resolve) => {
          resolveDeferredAssets = () => resolve(result);
        });
      }
      return result;
    },
    getUnlockedAchievements: async (objectId: string, shop: string) => {
      calls.push(["achievements", shop, objectId]);
      return [];
    },
    hydraApi: { get: async () => null },
    onLibraryBatchComplete: (handler: () => void) => {
      libraryBatchHandler = handler;
      return () => {
        if (libraryBatchHandler === handler) libraryBatchHandler = null;
      };
    },
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
      resolvePreferredGameAssets:
        preferredAssetsHelpers.resolvePreferredGameAssets,
      buildFavoriteToastOptions: async () => ({ title: "Updated" }),
      buildGameToastVisualOptions: async () => ({}),
    },
  };
  let runningGames = runningId
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
    downloadGame: LibraryGame | null;
    presentationGame: LibraryGame & { members: LibraryGame[] };
    catalogueGame: { shop: string; objectId: string };
    isGameRunning: boolean;
    shopDetails: ShopDetailsWithAssets | null;
    preferredAssets: {
      iconUrl: string | null;
      logoImageUrl: string | null;
      libraryHeroImageUrl: string | null;
      coverImageUrl: string | null;
      iconSrc: string;
      heroSrc: string;
      coverSrc: string;
    };
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
    async setArtwork(selection: GameArtworkSelection | null) {
      if (selection)
        selections.set(selection.shop + ":" + selection.objectId, selection);
      else selections.delete(epic.id);
      await act(async () => libraryBatchHandler?.());
    },
    async setRunningGame(id: string) {
      runningGames = { [id]: { id, sessionDurationInMillis: 10000 } };
      await act(async () => root.render(React.createElement(Component)));
    },
    async resolveDeferredAssets() {
      assert.ok(resolveDeferredAssets, "an artwork request must be pending");
      await act(async () => resolveDeferredAssets!());
    },
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
  it("keeps the downloading Epic identity separate from the installed Steam launch identity", async () => {
    const steam = {
      ...epic,
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      executablePath: "steam.exe",
      hasActiveEpicImport: false,
    } as LibraryGame;
    const downloading = {
      ...epic,
      executablePath: null,
      download: { status: "active", progress: 0.25 } as Download,
    };
    const state = await fixture([steam, downloading]);
    try {
      assert.equal(state.details.game, steam);
      assert.equal(state.details.downloadGame, downloading);
      await state.details.openGame();
      assert.ok(
        state.calls.some(
          ([action, shop, id]) =>
            action === "open" && shop === "steam" && id === steam.objectId
        )
      );
      assert.equal(state.details.downloadGame?.shop, "epic");
      assert.equal(state.details.downloadGame?.objectId, epic.objectId);
    } finally {
      await state.close();
    }
  });

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

describe("Big Picture owned artwork", () => {
  it("reads Steam catalogue defaults with the Epic selection for both asset getters", async () => {
    const selection = artwork(epic, {
      icon: { url: "https://artwork.test/epic-icon.png", artworkId: 1 },
      hero: { url: "https://artwork.test/epic-hero.png", artworkId: 2 },
      grid: { url: "https://artwork.test/epic-cover.png", artworkId: 3 },
      logo: { url: "https://artwork.test/epic-logo.png", artworkId: 4 },
    });
    const state = await fixture([epic], undefined, undefined, {
      selections: [selection],
    });
    try {
      for (const action of ["details", "assets"]) {
        assert.ok(
          state.calls.some(
            ([name, shop, id, options]) =>
              name === action &&
              shop === "steam" &&
              id === "123" &&
              (options as GameArtworkOptions).artworkIdentity?.shop ===
                "epic" &&
              (options as GameArtworkOptions).artworkIdentity?.objectId ===
                epic.objectId
          )
        );
      }
      assert.equal(
        state.details.preferredAssets.iconUrl,
        selection.selected.icon!.url
      );
      assert.equal(
        state.details.preferredAssets.logoImageUrl,
        selection.selected.logo!.url
      );
      assert.equal(
        state.details.preferredAssets.libraryHeroImageUrl,
        selection.selected.hero!.url
      );
      assert.equal(
        state.details.preferredAssets.coverImageUrl,
        selection.selected.grid!.url
      );
      assert.equal(state.details.shopDetails?.assets?.shop, "steam");
    } finally {
      await state.close();
    }
  });

  it("uses owned artwork from shop details when the asset getter has no result", async () => {
    const selection = artwork(epic, {
      hero: { url: "https://artwork.test/epic-hero.png", artworkId: 2 },
    });
    const state = await fixture([epic], undefined, undefined, {
      selections: [selection],
      detailsAssets: true,
      nullAssets: true,
    });
    try {
      assert.equal(state.details.shopDetails?.name, "Steam metadata");
      assert.equal(
        state.details.preferredAssets.libraryHeroImageUrl,
        selection.selected.hero!.url
      );
      assert.equal(
        state.details.preferredAssets.iconUrl,
        catalogueAssets.iconUrl
      );
    } finally {
      await state.close();
    }
  });

  it("refreshes selected and cleared artwork on a library batch without inheriting the catalogue selection", async () => {
    const steamSelection = artwork(
      { shop: "steam", objectId: "123" },
      { icon: { url: "https://artwork.test/steam-icon.png", artworkId: 5 } }
    );
    const state = await fixture([epic], undefined, undefined, {
      selections: [steamSelection],
    });
    try {
      const selection = artwork(epic, {
        hero: { url: "https://artwork.test/epic-hero.png", artworkId: 2 },
      });
      await state.setArtwork(selection);
      assert.equal(
        state.details.preferredAssets.libraryHeroImageUrl,
        selection.selected.hero!.url
      );
      assert.equal(
        state.details.preferredAssets.iconUrl,
        catalogueAssets.iconUrl
      );
      await state.setArtwork(null);
      assert.equal(
        state.details.preferredAssets.libraryHeroImageUrl,
        catalogueAssets.libraryHeroImageUrl
      );
      assert.equal(
        state.details.preferredAssets.iconUrl,
        catalogueAssets.iconUrl
      );
    } finally {
      await state.close();
    }
  });

  it("keeps manual uploads above selected artwork", async () => {
    const game = {
      ...epic,
      customIconUrl: "local:C:/artwork/icon.png",
      customLogoImageUrl: "local:C:/artwork/logo.png",
      customHeroImageUrl: "local:C:/artwork/hero.png",
      customCoverImageUrl: "local:C:/artwork/cover.png",
    };
    const selection = artwork(epic, {
      icon: { url: "https://artwork.test/epic-icon.png", artworkId: 1 },
      hero: { url: "https://artwork.test/epic-hero.png", artworkId: 2 },
      grid: { url: "https://artwork.test/epic-cover.png", artworkId: 3 },
      logo: { url: "https://artwork.test/epic-logo.png", artworkId: 4 },
    });
    const state = await fixture([game], undefined, undefined, {
      selections: [selection],
    });
    try {
      assert.equal(state.details.preferredAssets.iconUrl, game.customIconUrl);
      assert.equal(
        state.details.preferredAssets.logoImageUrl,
        game.customLogoImageUrl
      );
      assert.equal(
        state.details.preferredAssets.libraryHeroImageUrl,
        game.customHeroImageUrl
      );
      assert.equal(
        state.details.preferredAssets.coverImageUrl,
        game.customCoverImageUrl
      );
    } finally {
      await state.close();
    }
  });

  it("discards artwork from the previous owned copy when the operational identity changes", async () => {
    const steam = {
      ...epic,
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      hasActiveEpicImport: false,
      executablePath: "steam.exe",
    } as LibraryGame;
    const epicSelection = artwork(epic, {
      hero: { url: "https://artwork.test/epic-hero.png", artworkId: 2 },
    });
    const steamSelection = artwork(steam, {
      hero: { url: "https://artwork.test/steam-hero.png", artworkId: 6 },
    });
    const state = await fixture([epic, steam], epic.id, undefined, {
      selections: [epicSelection, steamSelection],
      deferAssetsFor: epic.id,
    });
    try {
      assert.equal(state.details.shopDetails, null);
      await state.setRunningGame(steam.id);
      assert.equal(state.details.game?.id, steam.id);
      assert.equal(
        state.details.preferredAssets.libraryHeroImageUrl,
        steamSelection.selected.hero!.url
      );
      await state.resolveDeferredAssets();
      assert.equal(
        state.details.preferredAssets.libraryHeroImageUrl,
        steamSelection.selected.hero!.url
      );
    } finally {
      await state.close();
    }
  });

  it("uses the catalogue identity for artwork when there is no owned copy", async () => {
    const selection = artwork(
      { shop: "steam", objectId: "123" },
      { hero: { url: "https://artwork.test/steam-hero.png", artworkId: 6 } }
    );
    const state = await fixture([], undefined, undefined, {
      selections: [selection],
    });
    try {
      assert.equal(state.details.game, null);
      assert.equal(
        state.details.preferredAssets.libraryHeroImageUrl,
        selection.selected.hero!.url
      );
      const assetCall = state.calls.find(([action]) => action === "assets");
      assert.deepEqual(assetCall?.[3], {
        artworkIdentity: { shop: "steam", objectId: "123" },
      });
    } finally {
      await state.close();
    }
  });
});
