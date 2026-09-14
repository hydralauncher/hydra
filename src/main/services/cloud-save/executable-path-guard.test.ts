import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Game } from "@types";

import {
  CLOUD_SAVE_EXECUTABLE_MISSING_ERROR,
  createCloudSaveExecutableGuard,
  isCloudSaveExecutableMissingError,
} from "./executable-path-guard.ts";

const game = (overrides: Partial<Game> = {}): Game => ({
  title: "Game",
  iconUrl: null,
  libraryHeroImageUrl: null,
  logoImageUrl: null,
  playTimeInMilliseconds: 0,
  lastTimePlayed: null,
  objectId: "10",
  shop: "steam",
  remoteId: null,
  isDeleted: false,
  executablePath: "C:\\Games\\Game.exe",
  executablePathUpdatedAt: new Date("2026-07-25T00:00:00.000Z"),
  installedSizeInBytes: 1024,
  trackingExecutablePaths: ["C:\\Games\\Helper.exe"],
  ...overrides,
});

describe("cloud save executable path guard", () => {
  it("allows synchronization while the configured executable exists", async () => {
    const configuredGame = game();
    const savedGames: Game[] = [];
    const guard = createCloudSaveExecutableGuard({
      getGame: async () => configuredGame,
      saveGame: async (nextGame) => {
        savedGames.push(nextGame);
      },
      pathExists: async () => true,
      onExecutablePathCleared: () => {
        assert.fail("valid paths must not be cleared");
      },
    });

    assert.equal(await guard("10", "steam"), configuredGame);
    assert.deepEqual(savedGames, []);
  });

  it("clears a missing executable without changing tracking paths", async () => {
    const configuredGame = game();
    const savedGames: Game[] = [];
    const clearedPaths: string[] = [];
    const guard = createCloudSaveExecutableGuard({
      getGame: async () => configuredGame,
      saveGame: async (nextGame) => {
        savedGames.push(nextGame);
      },
      pathExists: async () => false,
      onExecutablePathCleared: (_game, executablePath) => {
        clearedPaths.push(executablePath);
      },
    });

    await assert.rejects(
      guard("10", "steam"),
      new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR)
    );
    assert.equal(savedGames.length, 1);
    assert.equal(savedGames[0].executablePath, null);
    assert.equal(savedGames[0].executablePathUpdatedAt, null);
    assert.equal(savedGames[0].installedSizeInBytes, null);
    assert.deepEqual(savedGames[0].trackingExecutablePaths, [
      "C:\\Games\\Helper.exe",
    ]);
    assert.deepEqual(clearedPaths, ["C:\\Games\\Game.exe"]);
  });

  it("does not clear a concurrently replaced executable path", async () => {
    const staleGame = game();
    const replacementGame = game({
      executablePath: "D:\\Games\\Game.exe",
    });
    const reads = [staleGame, replacementGame];
    const savedGames: Game[] = [];
    const guard = createCloudSaveExecutableGuard({
      getGame: async () => reads.shift(),
      saveGame: async (nextGame) => {
        savedGames.push(nextGame);
      },
      pathExists: async (executablePath) =>
        executablePath === replacementGame.executablePath,
      onExecutablePathCleared: () => {
        assert.fail("the replacement path must not be cleared");
      },
    });

    assert.equal(await guard("10", "steam"), replacementGame);
    assert.deepEqual(savedGames, []);
  });

  it("cancels when no executable path is configured", async () => {
    const guard = createCloudSaveExecutableGuard({
      getGame: async () => game({ executablePath: null }),
      saveGame: async () => {
        assert.fail("an already empty path must not be persisted again");
      },
      pathExists: async () => true,
      onExecutablePathCleared: () => {
        assert.fail("an already empty path must not emit an update");
      },
    });

    await assert.rejects(
      guard("10", "steam"),
      new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR)
    );
  });

  it("detects removal during a later pre-operation validation", async () => {
    let executableExists = true;
    let currentGame = game();
    const guard = createCloudSaveExecutableGuard({
      getGame: async () => currentGame,
      saveGame: async (nextGame) => {
        currentGame = nextGame;
      },
      pathExists: async () => executableExists,
      onExecutablePathCleared: () => {},
    });

    await guard("10", "steam");
    executableExists = false;

    await assert.rejects(
      guard("10", "steam"),
      new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR)
    );
    assert.equal(currentGame.executablePath, null);
  });

  it("recognizes only the dedicated cancellation error", () => {
    assert.equal(
      isCloudSaveExecutableMissingError(
        new Error(CLOUD_SAVE_EXECUTABLE_MISSING_ERROR)
      ),
      true
    );
    assert.equal(
      isCloudSaveExecutableMissingError(new Error("different_error")),
      false
    );
  });
});
