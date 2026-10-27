import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import type { LibraryGame } from "@types";

const permissiveStub: unknown = new Proxy(
  function stub() {
    return undefined;
  },
  {
    get: (_target, property) =>
      property === "__esModule" ? false : permissiveStub,
    apply: () => permissiveStub,
  }
);

const loadHelpers = () => {
  const filename = new URL("./helpers.ts", import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename.pathname,
  }).outputText;
  const exported: Record<string, unknown> = {};
  new Function("exports", "require", output)(exported, (name: string) =>
    name === "@shared"
      ? {
          getDisplayedPlayTimeInMilliseconds: (game: LibraryGame) =>
            game.playTimeInMilliseconds ?? 0,
          platformToRetroArchPlatform: {},
          RETROARCH_PLATFORM_LABELS: {},
        }
      : permissiveStub
  );
  return exported as {
    sortLibraryGames: (
      games: LibraryGame[],
      sortBy: "title_asc" | "most_played"
    ) => LibraryGame[];
    sortLibraryGamesIncrementally: (
      cache: unknown,
      games: LibraryGame[],
      sortBy: "title_asc" | "most_played"
    ) => { input: LibraryGame[]; output: LibraryGame[] };
  };
};

const game = (title: string, playTimeInMilliseconds = 0) =>
  ({
    id: `steam:${title}`,
    shop: "steam",
    objectId: title,
    title,
    playTimeInMilliseconds,
  }) as LibraryGame;

describe("sortLibraryGamesIncrementally", () => {
  const { sortLibraryGames, sortLibraryGamesIncrementally } = loadHelpers();

  it("matches a full sort after small changes that keep or change the order", () => {
    const games = ["delta", "alpha", "charlie", "bravo", "echo"].map((title) =>
      game(title)
    );
    const cache = sortLibraryGamesIncrementally(null, games, "title_asc");
    assert.deepEqual(
      cache.output.map((entry) => entry.title),
      ["alpha", "bravo", "charlie", "delta", "echo"]
    );

    const sameOrder = [...games];
    sameOrder[2] = { ...games[2], playTimeInMilliseconds: 5 };
    const kept = sortLibraryGamesIncrementally(cache, sameOrder, "title_asc");
    assert.deepEqual(kept.output, sortLibraryGames(sameOrder, "title_asc"));
    assert.equal(kept.output[2], sameOrder[2]);

    const moved = [...games];
    moved[1] = { ...games[1], title: "foxtrot" };
    const resorted = sortLibraryGamesIncrementally(cache, moved, "title_asc");
    assert.deepEqual(resorted.output, sortLibraryGames(moved, "title_asc"));
  });

  it("re-sorts when the sort option or list size changes", () => {
    const games = [game("a", 1), game("b", 3), game("c", 2)];
    const cache = sortLibraryGamesIncrementally(null, games, "title_asc");

    const byPlaytime = sortLibraryGamesIncrementally(
      cache,
      games,
      "most_played"
    );
    assert.deepEqual(
      byPlaytime.output.map((entry) => entry.title),
      ["b", "c", "a"]
    );

    const shorter = sortLibraryGamesIncrementally(
      cache,
      games.slice(1),
      "title_asc"
    );
    assert.deepEqual(
      shorter.output.map((entry) => entry.title),
      ["b", "c"]
    );
  });
});
