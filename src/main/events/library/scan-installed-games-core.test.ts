import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Game } from "@types";

import {
  collectClearedExecutables,
  findUnlinkedGames,
  type ClearedExecutable,
} from "./scan-installed-games-core.ts";

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
  executablePath: null,
  executablePathUpdatedAt: null,
  installedSizeInBytes: null,
  trackingExecutablePaths: [],
  ...overrides,
});

const removedExecutable: ClearedExecutable = {
  title: "Removed Game",
  executablePath: String.raw`D:\Games\Removed Game\game.exe`,
  iconUrl: "https://example.com/removed.png",
};

const movedExecutable: ClearedExecutable = {
  title: "Moved Game",
  executablePath: String.raw`D:\Games\Moved Game\game.exe`,
  iconUrl: null,
};

describe("installed games scan cleared executables", () => {
  it("keeps the path each cleared game had before it was cleared", () => {
    const clearedExecutables = collectClearedExecutables(
      [
        {
          key: "steam:10",
          game: game({ ...removedExecutable, objectId: "10" }),
        },
        {
          key: "steam:20",
          game: game({
            objectId: "20",
            executablePath: String.raw`D:\Games\Installed Game\game.exe`,
          }),
        },
      ],
      new Set(["steam:10"])
    );

    assert.deepEqual(
      [...clearedExecutables],
      [["steam:10", removedExecutable]]
    );
  });

  it("leaves out games that were linked again in the same scan", async () => {
    const clearedExecutables = new Map([
      ["steam:10", removedExecutable],
      ["steam:20", movedExecutable],
    ]);
    const currentGames = new Map([
      ["steam:10", game({ objectId: "10" })],
      [
        "steam:20",
        game({
          objectId: "20",
          executablePath: String.raw`E:\Games\Moved Game\game.exe`,
        }),
      ],
    ]);

    const unlinkedGames = await findUnlinkedGames(
      clearedExecutables,
      async (keys) => keys.map((key) => currentGames.get(key))
    );

    assert.deepEqual(unlinkedGames, [removedExecutable]);
  });
});
