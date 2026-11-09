import assert from "node:assert/strict";
import { it } from "node:test";
import type { LibraryGame } from "@types";
import { selectLibraryPresentationIndex } from "./library-presentation.js";

const game = (shop: "steam" | "epic", objectId: string, canonicalId: string) =>
  ({
    id: `${shop}:${objectId}`,
    shop,
    objectId,
    canonicalId,
    title: objectId,
    catalogueGame: { shop: "steam", objectId: canonicalId },
    executablePath: `${shop}.exe`,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    download: null,
  }) as LibraryGame;

it("shares one library projection across every row and menu", () => {
  const library = Array.from({ length: 2000 }, (_, i) =>
    game("epic", `ns:${i}`, `${i}`)
  );
  const state = {
    library: { downloadLibrary: library },
    gameRunning: { gameRunning: null },
  };
  const before = selectLibraryPresentationIndex.recomputations();
  const index = selectLibraryPresentationIndex(state);
  for (const item of library) {
    assert.equal(selectLibraryPresentationIndex(state), index);
    assert.equal(index.owned.get(item.id)?.operationalGame, item);
    assert.equal(
      index.catalogue.get(`steam:${item.canonicalId}`)?.operationalGame,
      item
    );
  }
  assert.equal(selectLibraryPresentationIndex.recomputations() - before, 1);
});

it("updates the operational copy on running-game and library changes", () => {
  const steam = game("steam", "123", "123");
  const epic = game("epic", "ns:123", "123");
  const library = { downloadLibrary: [steam, epic] };
  const first = selectLibraryPresentationIndex({
    library,
    gameRunning: { gameRunning: null },
  });
  assert.equal(first.owned.get(epic.id)?.operationalGame, steam);
  const running = selectLibraryPresentationIndex({
    library,
    gameRunning: { gameRunning: { id: epic.id } },
  });
  assert.equal(running.owned.get(steam.id)?.operationalGame, epic);
  assert.notEqual(first, running);
  const removed = selectLibraryPresentationIndex({
    library: { downloadLibrary: [steam] },
    gameRunning: { gameRunning: null },
  });
  assert.equal(removed.owned.has(epic.id), false);
});

it("keeps ambiguous catalogue matches separate from owned records", () => {
  const first = game("epic", "ns:first", "first");
  const second = {
    ...game("epic", "ns:second", "second"),
    catalogueGame: first.catalogueGame,
  };
  const index = selectLibraryPresentationIndex({
    library: { downloadLibrary: [first, second] },
    gameRunning: { gameRunning: null },
  });
  assert.equal(index.catalogue.get("steam:first"), null);
  assert.equal(index.owned.get(first.id)?.operationalGame, first);
  assert.equal(index.owned.get(second.id)?.operationalGame, second);
});
