import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { IpcMainInvokeEvent } from "electron";
import type { Game, LibraryGame, ShopAssets } from "@types";
import { getContextualEpicGame } from "../../services/epic/import-visibility.js";
import { belongsToLibraryCollection } from "../../services/library-sync/game-visibility.js";
import { EpicLibraryArtworkQueue } from "../../services/epic-library-artwork-queue.js";

const handlerCode = ts.transpileModule(
  fs.readFileSync(new URL("./get-library.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }
).outputText;

type LibraryHandler = (
  event: IpcMainInvokeEvent,
  includeConcealed?: boolean
) => Promise<LibraryGame[]>;
type MissingFolder = "installer" | "installed" | "both" | "none";

function fixture(
  missing: MissingFolder,
  overrides: Partial<Game> = {},
  options: {
    records?: Array<[string, Game]>;
    queue?: EpicLibraryArtworkQueue;
    deleted?: string[];
    discardable?: boolean;
  } = {}
) {
  const game: Game = {
    shop: "steam",
    objectId: "123",
    title: "Game",
    iconUrl: null,
    logoImageUrl: null,
    libraryHeroImageUrl: null,
    playTimeInMilliseconds: 10,
    remoteId: "remote-game",
    isDeleted: false,
    lastTimePlayed: null,
    installerSizeInBytes: 100,
    installedSizeInBytes: 200,
    executablePath: path.join("games", "game", "game.exe"),
    customHeroImageUrl: "custom-hero",
    ...overrides,
  };
  const key = `${game.shop}:${game.objectId}`;
  const download = { downloadPath: "downloads", folderName: "installer" };
  const missingPaths = new Set<string>();
  if (missing === "installer" || missing === "both")
    missingPaths.add(path.join(download.downloadPath, download.folderName));
  if (missing === "installed" || missing === "both")
    missingPaths.add(path.dirname(game.executablePath!));
  const writeError = new Error("database unavailable");
  const writes: { key: string; patch: Partial<Game> }[] = [];
  const pendingWrites: { resolve: () => void; reject: () => void }[] = [];
  const errors: { message: string; error: unknown }[] = [];
  const handlers = new Map<string, LibraryHandler>();
  const assets = new Map<string, Partial<ShopAssets>>();
  const selections = new Map<string, unknown>();
  const deleted = new Set(options.deleted ?? []);
  const cleared: { shop: string; objectId: string }[] = [];
  const pendingClears: { reject: () => void }[] = [];
  const dependencies: Record<string, unknown> = {
    "@main/services/epic-library-artwork": {
      epicLibraryArtworkQueue: options.queue ?? { schedule: () => {} },
    },
    "node:path": path,
    "../../../types": {
      canDiscardDownload: () => options.discardable ?? false,
    },
    "@main/helpers/is-path-deleted": {
      isPathDeleted: async (target: string) => deleted.has(target),
    },
    "@main/helpers/download-game-helper": {
      clearFinishedDownload: (shop: string, objectId: string) => {
        cleared.push({ shop, objectId });
        return new Promise<void>((_resolve, reject) => {
          pendingClears.push({ reject: () => reject(writeError) });
        });
      },
    },
    "node:fs": {
      existsSync: (filePath: string) => !missingPaths.has(filePath),
    },
    "../register-event": {
      registerEvent: (name: string, handler: LibraryHandler) => {
        handlers.set(name, handler);
      },
    },
    "@main/level": {
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      gamesSublevel: {
        iterator: () => ({
          all: async () => options.records ?? [[key, { ...game }]],
        }),
        get: async (gameKey: string) =>
          (options.records ?? [[key, game]]).find(([k]) => k === gameKey)?.[1],
      },
      downloadsSublevel: {
        getMany: async (gameKeys: string[]) => gameKeys.map(() => download),
        // ADDED FOR RACE CONDITION CHECK
        get: async (_gameKey: string) => download,
      },
      gamesArtworkSelectionSublevel: {
        getMany: async (gameKeys: string[]) =>
          gameKeys.map((gameKey) => selections.get(gameKey) ?? null),
      },
      gamesShopAssetsSublevel: {
        getMany: async (gameKeys: string[]) =>
          gameKeys.map((gameKey) => assets.get(gameKey) ?? null),
      },
      gamesShopCacheSublevel: { iterator: () => ({ all: async () => [] }) },
    },
    "@shared": {
      composeAssetsWithArtwork: (
        defaults: Partial<ShopAssets> | null,
        selection: unknown
      ) => ({
        ...defaults,
        iconUrl: defaults?.iconUrl ?? "sgdb-icon",
        selection,
      }),
    },
    "@main/services/hydra-api": {
      HydraApi: { getAuthContext: () => null, isLoggedIn: () => true },
    },
    "@main/services/epic/import-visibility": { getContextualEpicGame },
    "@main/services/library-sync/game-visibility": {
      belongsToLibraryCollection,
    },
    "@main/services/game-record-updater": {
      updateGameRecord: (gameKey: string, patch: Partial<Game>) => {
        writes.push({ key: gameKey, patch: { ...patch } });
        return new Promise<void>((resolve, reject) => {
          pendingWrites.push({ resolve, reject: () => reject(writeError) });
        });
      },
    },
    "@main/services/logger": {
      logger: {
        error: (message: string, error: unknown) => {
          errors.push({ message, error });
        },
      },
    },
    "@main/services/achievements/achievement-memory-store": {
      resolveAchievementCount: (
        _shop: string,
        _objectId: string,
        persisted?: number | null
      ) => persisted ?? 0,
      resolveUnlockedAchievementCount: () => 0,
    },
  };
  runInNewContext(handlerCode, {
    exports: {},
    require: (id: string) => {
      assert.ok(
        Object.hasOwn(dependencies, id),
        `Unexpected dependency: ${id}`
      );
      return dependencies[id];
    },
  });
  return {
    key,
    assets,
    selections,
    game,
    download,
    writeError,
    writes,
    pendingWrites,
    cleared,
    pendingClears,
    errors,
    read: () => handlers.get("getLibrary")!({} as IpcMainInvokeEvent),
    readAll: () => handlers.get("getLibrary")!({} as IpcMainInvokeEvent, true),
    readHidden: () =>
      handlers.get("getHiddenLibrary")!({} as IpcMainInvokeEvent),
  };
}

for (const hiddenCount of [0, 2]) {
  it(`retains the full artwork backlog after reading ${hiddenCount} hidden games`, async () => {
    const template = fixture("none").game;
    const records: Array<[string, Game]> = Array.from(
      { length: 200 },
      (_, index) => [
        `epic:${index}`,
        {
          ...template,
          shop: "epic",
          objectId: String(index),
          remoteId: null,
          installerSizeInBytes: null,
          installedSizeInBytes: null,
          isConcealed: index < hiddenCount,
        },
      ]
    );
    let release!: () => void;
    const attempted: string[] = [];
    const queue = new EpicLibraryArtworkQueue(
      async (game) => {
        attempted.push(game.id);
        if (attempted.length === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return false;
      },
      () => assert.fail("unchanged artwork must not notify"),
      Date.now,
      async () => {}
    );
    const f = fixture("none", {}, { records, queue });
    assert.equal((await f.readAll()).length, 200);
    assert.equal(attempted.length, 1);
    assert.equal((await f.readHidden()).length, hiddenCount);
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual([...attempted].sort(), records.map(([key]) => key).sort());
  });
}

describe("library size cleanup", () => {
  for (const missing of ["installer", "installed", "both"] as const) {
    it(`logs rejected ${missing} cleanup while returning the library`, async () => {
      const f = fixture(missing);
      const games = await f.read();
      assert.equal(games.length, 1);
      assert.equal(
        games[0].installerSizeInBytes,
        missing === "installed" ? f.game.installerSizeInBytes : null
      );
      assert.equal(
        games[0].installedSizeInBytes,
        missing === "installer" ? f.game.installedSizeInBytes : null
      );
      assert.equal(games[0].iconUrl, "sgdb-icon");
      assert.equal(games[0].customHeroImageUrl, "custom-hero");
      assert.equal(f.errors.length, 0);
      const expectedWrites: typeof f.writes = [];
      if (missing !== "installed")
        expectedWrites.push({
          key: f.key,
          patch: { installerSizeInBytes: null },
        });
      if (missing !== "installer")
        expectedWrites.push({
          key: f.key,
          patch: {
            installerSizeInBytes:
              missing === "both" ? null : f.game.installerSizeInBytes,
            installedSizeInBytes: null,
          },
        });
      assert.deepEqual(f.writes, expectedWrites);
      f.pendingWrites.forEach((write) => write.reject());
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(f.errors.length, expectedWrites.length);
      const operations =
        missing === "both" ? ["installer", "installed"] : [missing];
      assert.deepEqual(
        f.errors.map(({ message }) => message),
        operations.map(
          (operation) =>
            `Failed to clear missing ${operation} size for ${f.key}`
        )
      );
      assert.ok(f.errors.every(({ error }) => error === f.writeError));
    });
  }

  it("keeps successful cleanup silent", async () => {
    const f = fixture("both");
    const games = await f.read();
    f.pendingWrites.forEach((write) => write.resolve());
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(games[0].installerSizeInBytes, null);
    assert.equal(games[0].installedSizeInBytes, null);
    assert.equal(f.errors.length, 0);
  });

  it("keeps existing folder sizes without scheduling writes", async () => {
    const f = fixture("none");
    const games = await f.read();
    assert.equal(games[0].installerSizeInBytes, f.game.installerSizeInBytes);
    assert.equal(games[0].installedSizeInBytes, f.game.installedSizeInBytes);
    assert.equal(f.writes.length, 0);
    assert.equal(f.errors.length, 0);
  });

  it("keeps the Steam presentation icon on an underlying Epic record", async () => {
    const f = fixture("none");
    Object.assign(f.game, {
      shop: "epic",
      objectId: "namespace:item",
      canonicalId: "canonical-game",
      catalogueGame: { shop: "steam", objectId: "123" },
      availableShops: ["steam", "epic"],
    });
    const [game] = await f.read();
    assert.equal(game.shop, "epic");
    assert.equal(game.objectId, "namespace:item");
    assert.equal(game.iconUrl, "sgdb-icon");
    assert.equal(game.catalogueGame?.shop, "steam");
    assert.equal(game.playTimeInMilliseconds, f.game.playTimeInMilliseconds);
    assert.equal(f.writes.length, 0);
  });

  it("presents the linked Steam total for an Epic copy without its own definitions", async () => {
    const template = fixture("none").game;
    const epic = {
      ...template,
      shop: "epic",
      objectId: "namespace:item",
      achievementCount: 0,
      catalogueGame: { shop: "steam", objectId: "456" },
    } as Game;
    const steam = { ...template, objectId: "456", achievementCount: 35 };
    const own = {
      ...epic,
      objectId: "namespace:own",
      achievementCount: 12,
    } as Game;
    const f = fixture(
      "none",
      {},
      {
        records: [
          ["epic:namespace:item", epic],
          ["steam:456", steam],
          ["epic:namespace:own", own],
        ],
      }
    );
    const games = await f.read();
    const count = (objectId: string) =>
      games.find((game) => game.objectId === objectId)?.achievementCount;
    assert.equal(count("namespace:item"), 35);
    assert.equal(count("namespace:own"), 12);
  });

  it("uses the catalogue cache instead of old Epic assets and keeps the real artwork selection", async () => {
    const f = fixture("none", {
      shop: "epic",
      objectId: "namespace:item",
      catalogueGame: { shop: "steam", objectId: "456" },
    });
    f.assets.set(f.key, { title: "Epic title", iconUrl: "epic-icon" });
    f.assets.set("steam:456", {
      shop: "steam",
      objectId: "456",
      title: "Steam title",
      iconUrl: "steam-icon",
      coverImageUrl: "steam-cover",
    });
    const selection = { selected: { hero: { url: "picked-hero" } } };
    f.selections.set(f.key, selection);
    const [game] = await f.read();
    assert.equal(game.title, "Steam title");
    assert.equal(game.iconUrl, "steam-icon");
    assert.equal(game.coverImageUrl, "steam-cover");
    assert.equal(game.shop, "epic");
    assert.equal(game.objectId, "namespace:item");
    assert.deepEqual(
      (game as LibraryGame & { selection: unknown }).selection,
      selection
    );
    assert.equal(game.customHeroImageUrl, "custom-hero");
    assert.equal(f.writes.length, 0);
  });
});

describe("externally deleted library paths", () => {
  const executablePath = path.join("games", "game", "game.exe");
  const installerFolder = path.join("downloads", "installer");
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  it("keeps the executable path while the file still exists", async () => {
    const f = fixture("none");
    const [game] = await f.read();
    assert.equal(game.executablePath, f.game.executablePath);
    assert.equal(game.installedSizeInBytes, f.game.installedSizeInBytes);
    assert.equal(f.writes.length, 0);
  });

  it("clears the executable path and related fields when the file was deleted", async () => {
    const f = fixture("none", {}, { deleted: [executablePath] });
    const [game] = await f.read();
    assert.equal(game.executablePath, null);
    assert.equal(game.executablePathUpdatedAt, null);
    // The original value is not forced to false (prevents bugs on offline drives)
    assert.equal(game.automaticCloudSync, undefined);
    assert.equal(game.installedSizeInBytes, null);
    assert.equal(game.installerSizeInBytes, f.game.installerSizeInBytes);

    // The database update should not contain automaticCloudSync: false
    assert.deepEqual(f.writes, [
      {
        key: f.key,
        patch: {
          executablePath: null,
          executablePathUpdatedAt: null,
          installedSizeInBytes: null,
        },
      },
    ]);
  });

  it("logs a rejected executable cleanup while returning the library", async () => {
    const f = fixture("none", {}, { deleted: [executablePath] });
    const games = await f.read();
    assert.equal(games.length, 1);
    f.pendingWrites.forEach((write) => write.reject());
    await flush();
    assert.deepEqual(
      f.errors.map(({ message }) => message),
      [`Failed to clear missing executable path for ${f.key}`]
    );
    assert.ok(f.errors.every(({ error }) => error === f.writeError));
  });

  it("drops a finished download whose folder was deleted", async () => {
    const f = fixture(
      "none",
      {},
      { deleted: [installerFolder], discardable: true }
    );
    const [game] = await f.read();
    assert.equal(game.download, null);
    assert.deepEqual(f.cleared, [{ shop: "steam", objectId: "123" }]);
    assert.equal(f.writes.length, 0);
  });

  it("keeps a download that cannot be discarded even if its folder is gone", async () => {
    const f = fixture(
      "none",
      {},
      { deleted: [installerFolder], discardable: false }
    );
    const [game] = await f.read();
    assert.deepEqual(game.download, f.download);
    assert.equal(f.cleared.length, 0);
  });

  it("keeps a finished download while its folder still exists", async () => {
    const f = fixture("none", {}, { discardable: true });
    const [game] = await f.read();
    assert.deepEqual(game.download, f.download);
    assert.equal(f.cleared.length, 0);
  });

  it("logs a rejected download cleanup while returning the library", async () => {
    const f = fixture(
      "none",
      {},
      { deleted: [installerFolder], discardable: true }
    );
    const games = await f.read();
    assert.equal(games.length, 1);
    f.pendingClears.forEach((clear) => clear.reject());
    await flush();
    assert.deepEqual(
      f.errors.map(({ message }) => message),
      [`Failed to clear missing download folder for ${f.key}`]
    );
    assert.ok(f.errors.every(({ error }) => error === f.writeError));
  });
});
