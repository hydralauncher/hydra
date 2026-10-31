import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type {
  GameArtworkOptions,
  GameAssetsOptions,
  GameArtworkSelection,
  ShopAssets,
  ShopDetailsWithAssets,
} from "@types";
import { composeAssetsWithArtwork } from "../../../shared/artwork-resolver.js";

const catalogue = { shop: "steam" as const, objectId: "123" };
const owned = { shop: "epic" as const, objectId: "namespace:game" };
const defaults: ShopAssets = {
  ...catalogue,
  title: "Catalogue title",
  iconUrl: "default-icon",
  logoImageUrl: "default-logo",
  libraryHeroImageUrl: "default-hero",
  libraryImageUrl: "default-landscape",
  coverImageUrl: "default-cover",
  logoPosition: null,
  downloadSources: ["catalogue-source"],
};
const selection = (
  identity: typeof catalogue | typeof owned,
  prefix: string
): GameArtworkSelection => ({
  ...identity,
  updatedAt: 1,
  selected: {
    icon: { url: `${prefix}-icon`, artworkId: 1 },
    logo: { url: `${prefix}-logo`, artworkId: 2 },
    hero: { url: `${prefix}-hero`, artworkId: 3 },
    grid: { url: `${prefix}-cover`, artworkId: 4 },
  },
});

type Handler = (...args: unknown[]) => Promise<unknown>;

function fixture({ cachedAssets = true, cachedDetails = true } = {}) {
  const handlers = new Map<string, Handler>();
  const assetsCache = new Map<string, ShopAssets & { updatedAt: number }>();
  const detailsCache = new Map<string, unknown>();
  const selections = new Map<string, GameArtworkSelection>([
    ["steam:123", selection(catalogue, "steam-selected")],
    ["epic:namespace:game", selection(owned, "epic-selected")],
  ]);
  const selectionReads: string[] = [];
  const assetRequests: string[] = [];
  const metadata = {
    objectId: catalogue.objectId,
    name: "Catalogue metadata",
    content_descriptors: { ids: [] },
  };
  if (cachedAssets)
    assetsCache.set("steam:123", { ...defaults, updatedAt: Date.now() });
  if (cachedDetails) detailsCache.set("steam:123:english", metadata);
  const dependencies: Record<string, unknown> = {
    "../register-event": {
      registerEvent: (name: string, handler: Handler) => {
        handlers.set(name, handler);
      },
    },
    "@main/level": {
      levelKeys: {
        game: (shop: string, id: string) => `${shop}:${id}`,
        gameShopCacheItem: (shop: string, id: string, language: string) =>
          `${shop}:${id}:${language}`,
      },
      gamesArtworkSelectionSublevel: {
        get: async (key: string) => {
          selectionReads.push(key);
          return selections.get(key) ?? null;
        },
      },
      gamesShopAssetsSublevel: {
        get: async (key: string) => assetsCache.get(key) ?? null,
        put: async (key: string, value: ShopAssets & { updatedAt: number }) => {
          assetsCache.set(key, structuredClone(value));
        },
      },
      gamesShopCacheSublevel: {
        get: async (key: string) => detailsCache.get(key) ?? null,
        put: async (key: string, value: unknown) => {
          detailsCache.set(key, structuredClone(value));
        },
      },
    },
    "@main/services": {
      HydraApi: {
        get: async (url: string) => {
          assetRequests.push(url);
          return { ...defaults };
        },
      },
      getSteamLanguage: () => "english",
      getSteamAppDetails: async () => ({ ...metadata }),
      logger: { error: () => {} },
    },
    "@main/services/game-artwork": {
      resolveEpicDefaultArtwork: async (assets: ShopAssets) => assets,
    },
    "@main/services/epic-store-details": {},
    "@main/services/store-shop-details": {},
    "@shared": { composeAssetsWithArtwork },
  };
  for (const filename of ["get-game-assets.ts", "get-game-shop-details.ts"]) {
    const source = fs.readFileSync(new URL(filename, import.meta.url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    });
    runInNewContext(outputText, {
      exports: {},
      require: (name: string) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
      Date,
    });
  }
  return {
    selections,
    selectionReads,
    assetsCache,
    detailsCache,
    assetRequests,
    getAssets: (options?: GameAssetsOptions) =>
      handlers.get("getGameAssets")!(
        null,
        "123",
        "steam",
        options
      ) as Promise<ShopAssets | null>,
    getDetails: (options?: GameArtworkOptions) =>
      handlers.get("getGameShopDetails")!(
        null,
        "123",
        "steam",
        "en",
        options
      ) as Promise<ShopDetailsWithAssets | null>,
  };
}

function assertOwnedArtwork(assets: ShopAssets | null) {
  assert.ok(assets);
  assert.equal(assets.shop, catalogue.shop);
  assert.equal(assets.objectId, catalogue.objectId);
  assert.equal(assets.title, defaults.title);
  assert.equal(assets.iconUrl, "epic-selected-icon");
  assert.equal(assets.logoImageUrl, "epic-selected-logo");
  assert.equal(assets.libraryHeroImageUrl, "epic-selected-hero");
  assert.equal(assets.coverImageUrl, "epic-selected-cover");
  assert.equal(assets.libraryImageUrl, defaults.libraryImageUrl);
  assert.deepEqual(assets.downloadSources, defaults.downloadSources);
}

function assertUnselectedCache(state: ReturnType<typeof fixture>) {
  for (const assets of state.assetsCache.values()) {
    assert.equal(assets.iconUrl, defaults.iconUrl);
    assert.equal(assets.logoImageUrl, defaults.logoImageUrl);
    assert.equal(assets.libraryHeroImageUrl, defaults.libraryHeroImageUrl);
    assert.equal(assets.coverImageUrl, defaults.coverImageUrl);
    assert.equal(assets.selectedArtworkTypes, undefined);
  }
  for (const metadata of state.detailsCache.values()) {
    assert.equal(JSON.stringify(metadata).includes("selected"), false);
  }
  assert.equal(state.assetsCache.has("epic:namespace:game"), false);
}

describe("catalogue defaults with owned artwork", () => {
  for (const mode of ["cached", "missing", "forceFresh"] as const) {
    it(`uses the owned selection for ${mode} assets without caching the overlay`, async () => {
      const state = fixture({ cachedAssets: mode !== "missing" });
      assertOwnedArtwork(
        await state.getAssets({
          artworkIdentity: owned,
          forceFresh: mode === "forceFresh",
        })
      );
      assert.deepEqual(state.selectionReads, ["epic:namespace:game"]);
      assert.equal(state.assetRequests.length, mode === "cached" ? 0 : 1);
      if (mode !== "cached")
        assert.equal(state.assetRequests[0], "/games/steam/123/assets");
      assertUnselectedCache(state);
    });
  }

  for (const cachedDetails of [true, false]) {
    it(`uses owned artwork on ${cachedDetails ? "cached" : "fetched"} shop details`, async () => {
      const state = fixture({ cachedDetails });
      const details = await state.getDetails({ artworkIdentity: owned });
      assert.equal(
        details?.name,
        cachedDetails ? "Catalogue metadata" : defaults.title
      );
      assertOwnedArtwork(details?.assets ?? null);
      assert.deepEqual(state.selectionReads, ["epic:namespace:game"]);
      assertUnselectedCache(state);
    });
  }

  for (const getter of ["getAssets", "getDetails"] as const) {
    it(`${getter} uses raw catalogue defaults for unselected types and clearing`, async () => {
      const state = fixture();
      state.selections.set("epic:namespace:game", {
        ...selection(owned, "epic-selected"),
        selected: { grid: { url: "epic-selected-cover", artworkId: 4 } },
      });
      const read = async () => {
        if (getter === "getAssets")
          return state.getAssets({ artworkIdentity: owned });
        return (
          (await state.getDetails({ artworkIdentity: owned }))?.assets ?? null
        );
      };
      const partial = await read();
      assert.equal(partial?.coverImageUrl, "epic-selected-cover");
      assert.equal(partial?.iconUrl, defaults.iconUrl);
      assert.equal(partial?.logoImageUrl, defaults.logoImageUrl);
      assert.equal(partial?.libraryHeroImageUrl, defaults.libraryHeroImageUrl);

      state.selections.delete("epic:namespace:game");
      const cleared = await read();
      assert.equal(cleared?.coverImageUrl, defaults.coverImageUrl);
      assert.equal(cleared?.libraryHeroImageUrl, defaults.libraryHeroImageUrl);
      assert.equal(
        state.selectionReads.every((key) => key.startsWith("epic:")),
        true
      );
      assertUnselectedCache(state);
    });

    it(`${getter} preserves same-identity selections when no option is supplied`, async () => {
      const state = fixture();
      const assets =
        getter === "getAssets"
          ? await state.getAssets()
          : (await state.getDetails())?.assets;
      assert.equal(assets?.coverImageUrl, "steam-selected-cover");
      assert.equal(assets?.libraryHeroImageUrl, "steam-selected-hero");
      assert.deepEqual(state.selectionReads, ["steam:123"]);
      assertUnselectedCache(state);
    });
  }

  it("keeps absent defaults null without fabricating assets from a selection", async () => {
    const state = fixture({ cachedAssets: false });
    const details = await state.getDetails({ artworkIdentity: owned });
    assert.equal(details?.assets, null);
    assert.deepEqual(state.selectionReads, []);
  });
});
