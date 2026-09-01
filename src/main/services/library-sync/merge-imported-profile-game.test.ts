import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";
import { mergeImportedProfileGame } from "./merge-imported-profile-game.js";

const localGame = (overrides: Partial<Game> = {}): Game => ({
  title: "Local title",
  iconUrl: "local-icon",
  libraryHeroImageUrl: "local-hero",
  logoImageUrl: "local-logo",
  playTimeInMilliseconds: 1_000,
  lastTimePlayed: new Date("2026-01-01T00:00:00.000Z"),
  addedToLibraryAt: null,
  objectId: "game-1",
  shop: "launchbox",
  remoteId: null,
  isDeleted: false,
  platform: "Sony Playstation",
  discs: [
    {
      path: "/roms/game.iso",
      label: "Game",
      fileName: "game.iso",
      sku: "SLUS-00001",
    },
  ],
  ...overrides,
});

describe("mergeImportedProfileGame", () => {
  it("merges the imported game's remote profile state", () => {
    const local = localGame();
    const result = mergeImportedProfileGame(local, {
      id: "remote-1",
      objectId: "game-1",
      shop: "launchbox",
      createdAt: "2025-12-01T00:00:00.000Z",
      lastTimePlayed: "2026-02-01T00:00:00.000Z",
      runtime: 12,
      hasManuallyUpdatedPlaytime: true,
      isFavorite: true,
      isPinned: true,
      collectionIds: ["collection-1"],
    });

    assert.equal(result.remoteId, "remote-1");
    assert.equal(result.playTimeInMilliseconds, 12_000);
    assert.deepEqual(
      result.lastTimePlayed,
      new Date("2026-02-01T00:00:00.000Z")
    );
    assert.deepEqual(
      result.addedToLibraryAt,
      new Date("2025-12-01T00:00:00.000Z")
    );
    assert.equal(result.hasManuallyUpdatedPlaytime, true);
    assert.equal(result.favorite, true);
    assert.equal(result.isPinned, true);
    assert.deepEqual(result.collectionIds, ["collection-1"]);
  });

  it("preserves local ROM metadata and newer local state", () => {
    const local = localGame({
      remoteId: "old-remote-id",
      playTimeInMilliseconds: 20_000,
      favorite: true,
      collectionIds: ["local-collection"],
    });
    const result = mergeImportedProfileGame(local, {
      id: "remote-1",
      objectId: "game-1",
      shop: "launchbox",
      lastTimePlayed: "2025-01-01T00:00:00.000Z",
      playTimeInSeconds: 2,
    });

    assert.equal(result.remoteId, "remote-1");
    assert.equal(result.playTimeInMilliseconds, 20_000);
    assert.deepEqual(result.lastTimePlayed, local.lastTimePlayed);
    assert.equal(result.favorite, true);
    assert.deepEqual(result.collectionIds, ["local-collection"]);
    assert.equal(result.title, local.title);
    assert.equal(result.iconUrl, local.iconUrl);
    assert.equal(result.platform, local.platform);
    assert.deepEqual(result.discs, local.discs);
  });
});
