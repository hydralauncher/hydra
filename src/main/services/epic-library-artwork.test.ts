import assert from "node:assert/strict";
import fs from "node:fs";
import { runInNewContext } from "node:vm";
import { it } from "node:test";
import ts from "typescript";
import type { LibraryGame } from "@types";

const source = ts.transpileModule(
  fs.readFileSync(
    new URL("./epic-library-artwork.ts", import.meta.url),
    "utf8"
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText;

it("refreshes the catalogue cache while preserving the operational selection identity", async () => {
  let refresh!: (game: LibraryGame) => Promise<boolean>;
  let cachedKey = "";
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
        return { iconUrl: "resolved-icon" };
      },
    },
    "@main/level": {
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      gamesShopAssetsSublevel: {
        get: async (key: string) => {
          cachedKey = key;
          return { iconUrl: null };
        },
      },
    },
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
  assert.equal(
    await refresh({
      shop: "epic",
      objectId: "namespace:executable",
      catalogueGame: { shop: "epic", objectId: "namespace:item" },
    } as LibraryGame),
    true
  );
  assert.equal(cachedKey, "epic:namespace:item");
  assert.equal(
    JSON.stringify(calls),
    JSON.stringify([
      [
        "namespace:item",
        "epic",
        { artworkIdentity: { shop: "epic", objectId: "namespace:executable" } },
      ],
    ])
  );
});
