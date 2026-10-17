import assert from "node:assert/strict";
import fs from "node:fs";
import { runInNewContext } from "node:vm";
import { it } from "node:test";
import ts from "typescript";
import type { LibraryGame } from "@types";
import { composeAssetsWithArtwork } from "../../shared/artwork-resolver.js";

const source = ts.transpileModule(
  fs.readFileSync(
    new URL("./epic-library-artwork.ts", import.meta.url),
    "utf8"
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;

function createRefresh(options: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  selection?: unknown;
}) {
  let refresh!: (game: LibraryGame) => Promise<boolean>;
  const cacheReads: string[] = [];
  const selectionReads: string[] = [];
  const calls: unknown[][] = [];
  const dependencies: Record<string, unknown> = {
    "./epic-library-artwork-queue": {
      EpicLibraryArtworkQueue: class {
        constructor(callback: typeof refresh) {
          refresh = callback;
        }
      },
    },
    "../events/catalogue/get-game-assets": {
      getGameAssets: async (...args: unknown[]) => {
        calls.push(args);
        return options.after;
      },
    },
    "@main/level": {
      gamesArtworkSelectionSublevel: {
        get: async (key: string) => {
          selectionReads.push(key);
          return options.selection ?? null;
        },
      },
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      gamesShopAssetsSublevel: {
        get: async (key: string) => {
          cacheReads.push(key);
          return options.before;
        },
      },
    },
    "@shared": { composeAssetsWithArtwork },
    "./window-manager": { WindowManager: { sendToAppWindows: () => {} } },
    "./hydra-api": {
      HydraApi: {
        getAuthContext: () => ({ generation: 1 }),
        isAuthContextCurrent: () => true,
      },
    },
  };
  runInNewContext(source, {
    exports: {},
    require: (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
  });
  return { refresh, calls, cacheReads, selectionReads };
}

const operationalGame = {
  shop: "epic",
  objectId: "namespace:executable",
  catalogueGame: { shop: "epic", objectId: "namespace:item" },
} as LibraryGame;

it("refreshes the catalogue cache while preserving the operational selection identity", async () => {
  const fixture = createRefresh({
    before: { iconUrl: null },
    after: { iconUrl: "resolved-icon" },
  });
  assert.equal(await fixture.refresh(operationalGame), true);
  assert.deepEqual(fixture.cacheReads, ["epic:namespace:item"]);
  assert.deepEqual(fixture.selectionReads, ["epic:namespace:executable"]);
  assert.equal(
    JSON.stringify(fixture.calls),
    JSON.stringify([
      [
        "namespace:item",
        "epic",
        { artworkIdentity: { shop: "epic", objectId: "namespace:executable" } },
      ],
    ])
  );
});

for (const changed of [false, true]) {
  it(`compares manual selections consistently when defaults ${changed ? "change" : "stay unchanged"}`, async () => {
    const fixture = createRefresh({
      before: { shop: "epic", iconUrl: "default-icon" },
      selection: {
        selected: {
          icon: { url: "manual-icon" },
          grid: { url: "manual-grid" },
        },
      },
      after: {
        iconUrl: "manual-icon",
        coverImageUrl: "manual-grid",
        libraryHeroImageUrl: changed ? "new-hero" : undefined,
      },
    });
    assert.equal(await fixture.refresh(operationalGame), changed);
    assert.deepEqual(fixture.selectionReads, ["epic:namespace:executable"]);
  });
}
