import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Game } from "@types";
import { getGameCatalogueIdentity } from "../../shared/library-catalogue.js";

const source = ts.transpileModule(
  fs.readFileSync(
    new URL("./forget-play-later-game.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText;

function load(keys: string[]) {
  const store = new Set(keys);
  const exports: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    "@main/level": {
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      playLaterSublevel: {
        batch: async (operations: { type: string; key: string }[]) => {
          for (const operation of operations) store.delete(operation.key);
        },
      },
    },
    "@shared": { getGameCatalogueIdentity },
  };

  runInNewContext(source, {
    exports,
    require: (id: string) => {
      assert.ok(
        Object.hasOwn(dependencies, id),
        `Unexpected dependency: ${id}`
      );
      return dependencies[id];
    },
  });

  return {
    store,
    forget: exports.forgetPlayLaterGame as (game: Game) => Promise<void>,
  };
}

describe("forgetPlayLaterGame", () => {
  it("drops the entry of a game leaving the library and of its linked catalogue game", async () => {
    const { store, forget } = load([
      "epic:namespace:item",
      "steam:123",
      "steam:456",
    ]);

    await forget({
      shop: "epic",
      objectId: "namespace:item",
      catalogueGame: { shop: "steam", objectId: "123" },
    } as Game);

    assert.deepEqual([...store], ["steam:456"]);
  });
});
