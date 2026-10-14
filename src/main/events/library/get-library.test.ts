import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { IpcMainInvokeEvent } from "electron";
import type { Game, LibraryGame } from "@types";
import { getContextualEpicGame } from "../../services/epic/import-visibility.js";
import { belongsToLibraryCollection } from "../../services/library-sync/game-visibility.js";

const handlerCode = ts.transpileModule(
  fs.readFileSync(new URL("./get-library.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }
).outputText;

type LibraryHandler = (event: IpcMainInvokeEvent) => Promise<LibraryGame[]>;
type MissingFolder = "installer" | "installed" | "both" | "none";

function fixture(missing: MissingFolder) {
  const key = "steam:123";
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
  };
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
  const emptySublevel = { get: async () => null };
  const dependencies: Record<string, unknown> = {
    "node:path": path,
    "node:fs": {
      existsSync: (filePath: string) => !missingPaths.has(filePath),
    },
    "../register-event": {
      registerEvent: (name: string, handler: LibraryHandler) => {
        handlers.set(name, handler);
      },
    },
    "@main/level": {
      gamesSublevel: {
        iterator: () => ({ all: async () => [[key, { ...game }]] }),
      },
      downloadsSublevel: { get: async () => download },
      gamesArtworkSelectionSublevel: emptySublevel,
      gamesShopAssetsSublevel: emptySublevel,
      gamesShopCacheSublevel: { iterator: () => ({ all: async () => [] }) },
    },
    "@shared": { composeAssetsWithArtwork: () => ({ iconUrl: "sgdb-icon" }) },
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
      resolveAchievementCount: () => 0,
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
    game,
    writeError,
    writes,
    pendingWrites,
    errors,
    read: () => handlers.get("getLibrary")!({} as IpcMainInvokeEvent),
  };
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
});
