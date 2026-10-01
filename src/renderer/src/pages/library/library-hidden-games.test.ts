import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it, type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";

type TestGame = {
  id: string;
  objectId: string;
  shop: string;
  title: string;
};

const hiddenGame: TestGame = {
  id: "steam:123",
  objectId: "123",
  shop: "steam",
  title: "Hidden game",
};
const requireModule = createRequire(import.meta.url);
const noop = () => {};
const translate = (key: string) => key;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderLibrary(
  t: TestContext,
  options: {
    readHidden?: () => Promise<TestGame[]>;
    refreshRemote?: () => Promise<void>;
  } = {}
) {
  const dom = new JSDOM("<div id='root'></div>", {
    url: "https://hydra.test/library?collection=__hidden__",
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    ResizeObserver: class {
      observe = noop;
      disconnect = noop;
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previousGlobals = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  dom.window.HTMLElement.prototype.scrollTo = noop;
  dom.window.HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 900 }) as DOMRect;

  const root = createRoot(dom.window.document.getElementById("root")!);
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  });

  let userDetails: { id: string } | null = { id: "account-a" };
  let readHidden = options.readHidden ?? (async () => [hiddenGame]);
  let readVisible = async (): Promise<void> => {};
  let visibleReadCount = 0;
  let remoteRefreshCount = 0;
  let rowCount = 0;
  const updateLibrary = async () => {
    visibleReadCount++;
    await readVisible();
  };
  const loadCollections = async () => [];
  const collections: unknown[] = [];
  const library: unknown[] = [];
  const searchParams = new URLSearchParams("collection=__hidden__");
  const virtualizer = {
    measure: noop,
    getTotalSize: () => rowCount * 300,
    getVirtualItems: () =>
      Array.from({ length: rowCount }, (_, index) => ({
        key: index,
        index,
        start: index * 300,
      })),
  };
  Object.defineProperty(dom.window, "electron", {
    value: {
      getHiddenLibrary: () => readHidden(),
      refreshLibraryAssets: async () => {
        remoteRefreshCount++;
        await options.refreshRemote?.();
      },
      onLibraryBatchComplete: () => noop,
      onClassicsImportStatus: () => noop,
      getClassicsImportStatus: async () => false,
    },
  });

  const gameCard = ({ game }: { game: TestGame }) =>
    React.createElement("span", { "data-hidden-game": game.id }, game.title);
  const stubs: Record<string, unknown> = {
    "@tanstack/react-virtual": {
      useVirtualizer: ({ count }: { count: number }) => {
        rowCount = count;
        return virtualizer;
      },
    },
    "@renderer/hooks": {
      useLibrary: () => ({ library, updateLibrary }),
      useUserDetails: () => ({ userDetails }),
      useAppDispatch: () => noop,
      useAppSelector: (select: (state: unknown) => unknown) =>
        select({ library: { searchQuery: "" } }),
      useGameCollections: () => ({
        collections,
        loadCollections,
        hasLoaded: true,
        hasFailed: false,
      }),
    },
    "@renderer/features": {
      selectIsLibraryLoading: () => false,
      setHeaderTitle: noop,
    },
    "@primer/octicons-react": Object.fromEntries(
      [
        "HeartIcon",
        "TelescopeIcon",
        "FileDirectoryIcon",
        "SearchIcon",
        "SyncIcon",
      ].map((name) => [name, () => null])
    ),
    "react-i18next": { useTranslation: () => ({ t: translate }) },
    "@shared": {
      AuthPage: { SignIn: "sign-in" },
      removeDiacritics: (value: string) => value,
    },
    "@renderer/components": {
      CreateCollectionModal: () => null,
      GameContextMenu: () => null,
    },
    "@renderer/context": {
      useCollectionContextMenu: () => ({ openCollectionContextMenu: noop }),
    },
    "@renderer/helpers": {
      getGameCollectionIds: () => [],
      isGameInstalled: () => false,
      sortLibraryGames: (games: TestGame[]) => games,
    },
    "react-router-dom": {
      useSearchParams: () => [searchParams, noop],
    },
    "./library-game-card": { LibraryGameCard: gameCard },
    "./library-game-card-large": { LibraryGameCardLarge: gameCard },
    "./view-options": { ViewOptions: () => null },
    "./filter-options": { FilterOptions: () => null },
    "./category-filter": { CategoryFilter: () => null },
    "./installed-filter": { InstalledFilter: () => null },
    "./platform-filter": { PlatformFilter: () => null },
    "./source-filter": { SourceFilter: () => null },
    "./collections-filter": { CollectionsFilter: () => null },
    "./library-games-skeleton": { LibraryGamesSkeleton: () => null },
    "./library-category": {
      categoryShowsPlatforms: () => false,
      categoryShowsSources: () => false,
      filterLibraryGames: (games: TestGame[]) => games,
      getLibraryFilterOptions: () => ({ platforms: [], hasSteamGames: false }),
      readStoredLibraryFilters: () => ({ category: "all", sources: [] }),
    },
    "@renderer/session-state": {
      LIBRARY_INSTALLED_ONLY_STORAGE_KEY: "library-installed-only",
      LIBRARY_PLATFORMS_STORAGE_KEY: "library-platforms",
      LIBRARY_SOURCES_STORAGE_KEY: "library-sources",
    },
    "@renderer/components/classics-onboarding-modal/classics-onboarding-modal":
      {
        ClassicsOnboardingModal: () => null,
        hasDismissedClassicsOnboarding: () => true,
      },
  };
  const filename = path.resolve(
    process.cwd(),
    "src/renderer/src/pages/library/library.tsx"
  );
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const exports: { default?: React.ComponentType } = {};
  new Function("exports", "require", outputText)(exports, (name: string) => {
    if (name.endsWith(".scss")) return {};
    return stubs[name] ?? requireModule(name);
  });
  const Library = exports.default!;
  await act(async () => root.render(React.createElement(Library)));

  return {
    text: () => dom.window.document.body.textContent ?? "",
    games: () =>
      Array.from(
        dom.window.document.querySelectorAll("[data-hidden-game]")
      ).map((element) => element.textContent),
    counts: () => ({ visibleReadCount, remoteRefreshCount }),
    setHiddenRead: (nextRead: () => Promise<TestGame[]>) => {
      readHidden = nextRead;
    },
    setVisibleRead: (nextRead: () => Promise<void>) => {
      readVisible = nextRead;
    },
    changeAccount: async (nextAccountId: string) => {
      userDetails = { id: nextAccountId };
      await act(async () => root.render(React.createElement(Library)));
    },
    notifyVisibilityChange: async () => {
      await act(async () => {
        dom.window.dispatchEvent(
          new dom.window.Event("hydra:game-visibility-updated")
        );
      });
    },
    retry: async () => {
      const button = dom.window.document.querySelector("button");
      assert.ok(button, "the local hidden-library error offers a retry");
      await act(async () => button.click());
    },
  };
}

describe("hidden library local reads", () => {
  it("clears a prior local error after a successful visibility refresh", async (t) => {
    const page = await renderLibrary(t, {
      readHidden: async () => {
        throw new Error("local read failed");
      },
    });
    assert.match(page.text(), /hidden_games_load_failed/);

    page.setHiddenRead(async () => [hiddenGame]);
    await page.notifyVisibilityChange();

    assert.doesNotMatch(page.text(), /hidden_games_load_failed/);
    assert.deepEqual(page.games(), [hiddenGame.title]);
  });

  it("shows cached hidden games when the remote refresh fails on mount", async (t) => {
    const page = await renderLibrary(t, {
      refreshRemote: async () => {
        throw new Error("offline");
      },
    });

    assert.equal(page.counts().remoteRefreshCount, 1);
    assert.doesNotMatch(page.text(), /hidden_games_load_failed/);
    assert.deepEqual(page.games(), [hiddenGame.title]);
  });

  it("retries local reads even when the remote refresh remains offline", async (t) => {
    const page = await renderLibrary(t, {
      readHidden: async () => {
        throw new Error("local read failed");
      },
      refreshRemote: async () => {
        throw new Error("offline");
      },
    });
    assert.match(page.text(), /hidden_games_load_failed/);
    const before = page.counts();

    page.setHiddenRead(async () => [hiddenGame]);
    await page.retry();

    assert.equal(
      page.counts().remoteRefreshCount,
      before.remoteRefreshCount + 1
    );
    assert.equal(page.counts().visibleReadCount, before.visibleReadCount + 1);
    assert.doesNotMatch(page.text(), /hidden_games_load_failed/);
    assert.deepEqual(page.games(), [hiddenGame.title]);
  });

  it("keeps a genuine local error after a successful remote refresh and retry", async (t) => {
    const page = await renderLibrary(t, {
      readHidden: async () => {
        throw new Error("local read failed");
      },
    });

    assert.match(page.text(), /hidden_games_load_failed/);
    await page.retry();
    assert.match(page.text(), /hidden_games_load_failed/);
    assert.deepEqual(page.games(), []);
  });

  it("does not turn a visible-library retry failure into a hidden-library error", async (t) => {
    const page = await renderLibrary(t, {
      readHidden: async () => {
        throw new Error("local read failed");
      },
    });
    page.setHiddenRead(async () => [hiddenGame]);
    page.setVisibleRead(async () => {
      throw new Error("visible read failed");
    });

    await page.retry();

    assert.doesNotMatch(page.text(), /hidden_games_load_failed/);
    assert.deepEqual(page.games(), [hiddenGame.title]);
  });

  it("does not let an old account's successful read clear the current account's error", async (t) => {
    const oldRead = deferred<TestGame[]>();
    const page = await renderLibrary(t, { readHidden: () => oldRead.promise });
    page.setHiddenRead(async () => {
      throw new Error("current account local read failed");
    });
    await page.changeAccount("account-b");
    assert.match(page.text(), /hidden_games_load_failed/);

    await act(async () => oldRead.resolve([hiddenGame]));

    assert.match(page.text(), /hidden_games_load_failed/);
    assert.deepEqual(page.games(), []);
  });

  it("does not let an old account's failed read replace the current account's games", async (t) => {
    const oldRead = deferred<TestGame[]>();
    const page = await renderLibrary(t, { readHidden: () => oldRead.promise });
    page.setHiddenRead(async () => [hiddenGame]);
    await page.changeAccount("account-b");

    await act(async () => oldRead.reject(new Error("old account read failed")));

    assert.doesNotMatch(page.text(), /hidden_games_load_failed/);
    assert.deepEqual(page.games(), [hiddenGame.title]);
  });
});
