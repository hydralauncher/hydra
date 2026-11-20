import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Game, PlayLaterEntry, ShopAssets } from "@types";
import { getContextualEpicGame } from "../../services/epic/import-visibility.js";
import {
  isInLibrary,
  withoutLibraryGames,
} from "../../../shared/play-later.js";

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const compile = (file: string) =>
  ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;

const keyOf = (game: { shop: string; objectId: string }) =>
  `${game.shop}:${game.objectId}`;

const game = (overrides: Partial<Game>) =>
  ({
    shop: "steam",
    objectId: "1",
    title: "Game",
    isDeleted: false,
    ...overrides,
  }) as Game;

const entry = (shop: string, objectId: string) =>
  ({ shop, objectId, title: objectId, addedAt: 1 }) as PlayLaterEntry;

// An Epic import made under another Hydra account: hidden from this one.
const otherAccountEpicGame = game({
  shop: "epic",
  objectId: "namespace:item",
  source: "epic",
  epicImportScope: { environment: "production", userId: "someone-else" },
} as Partial<Game>);

function load(
  file: string,
  {
    games = [],
    entries = [],
    batchError,
  }: { games?: Game[]; entries?: PlayLaterEntry[]; batchError?: Error }
) {
  const handlers = new Map<string, Handler>();
  const store = new Map(entries.map((item) => [keyOf(item), item]));
  const errors: unknown[] = [];
  const dependencies: Record<string, unknown> = {
    "@main/level": {
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      gamesSublevel: {
        values: () => ({ all: async () => games }),
        get: async (key: string) => games.find((item) => keyOf(item) === key),
      },
      playLaterSublevel: {
        values: () => ({ all: async () => [...store.values()] }),
        put: async (key: string, value: PlayLaterEntry) => {
          store.set(key, value);
        },
        batch: async (operations: { key: string }[]) => {
          if (batchError) throw batchError;
          for (const operation of operations) store.delete(operation.key);
        },
      },
    },
    "@shared": { isInLibrary, withoutLibraryGames },
    "../register-event": {
      registerEvent: (name: string, handler: Handler) =>
        handlers.set(name, handler),
    },
    "@main/services/hydra-api": {
      HydraApi: {
        getAuthContext: () => ({ environment: "production", userId: "me" }),
      },
    },
    "@main/services/epic/import-visibility": { getContextualEpicGame },
    "@main/services/logger": {
      logger: {
        error: (_message: string, error: unknown) => errors.push(error),
      },
    },
  };

  runInNewContext(compile(file), {
    exports: {},
    require: (id: string) => {
      assert.ok(
        Object.hasOwn(dependencies, id),
        `Unexpected dependency: ${id}`
      );
      return dependencies[id];
    },
  });

  return { handlers, store, errors };
}

const readList = async (options: Parameters<typeof load>[1]) => {
  const loaded = load("./get-play-later.ts", options);
  const result = (await loaded.handlers.get("getPlayLater")!(
    {}
  )) as PlayLaterEntry[];
  return { ...loaded, ids: [...result].map(keyOf) };
};

const add = async (options: Parameters<typeof load>[1], assets: ShopAssets) => {
  const loaded = load("./add-game-to-play-later.ts", options);
  const result = await loaded.handlers.get("addGameToPlayLater")!({}, assets);
  return { ...loaded, result };
};

describe("getPlayLater", () => {
  it("keeps an entry whose Epic library copy belongs to another account", async () => {
    const { ids, store } = await readList({
      games: [otherAccountEpicGame],
      entries: [entry("epic", "namespace:item")],
    });

    assert.deepEqual(ids, ["epic:namespace:item"]);
    assert.equal(store.size, 1);
  });

  it("still returns the list when deleting stale entries fails", async () => {
    const failure = new Error("database busy");
    const { ids, errors } = await readList({
      games: [game({ objectId: "1" })],
      entries: [entry("steam", "1"), entry("steam", "2")],
      batchError: failure,
    });

    assert.deepEqual(ids, ["steam:2"]);
    assert.deepEqual(errors, [failure]);
  });
});

describe("addGameToPlayLater", () => {
  it("saves a game whose Epic library copy belongs to another account", async () => {
    const { result, store } = await add(
      { games: [otherAccountEpicGame] },
      entry("epic", "namespace:item") as unknown as ShopAssets
    );

    assert.notEqual(result, null);
    assert.equal(store.size, 1);
  });

  it("does not save a game linked to a library game through catalogueGame", async () => {
    const { result, store } = await add(
      {
        games: [
          game({
            shop: "epic",
            objectId: "namespace:item",
            catalogueGame: { shop: "steam", objectId: "123" },
          } as Partial<Game>),
        ],
      },
      entry("steam", "123") as unknown as ShopAssets
    );

    assert.equal(result, null);
    assert.equal(store.size, 0);
  });
});
