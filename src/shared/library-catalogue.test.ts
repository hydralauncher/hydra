import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Download, DownloadStatus, LibraryGame } from "@types";
import {
  findLibraryGamePresentation,
  groupLibraryGames,
  mergeLibraryCatalogueMetadata,
  isLibraryGameDownloading,
} from "./library-catalogue.js";
import { getDisplayedPlayTimeInMilliseconds } from "./playtime.js";

const makeGame = (overrides: Partial<LibraryGame> = {}): LibraryGame => ({
  id: "epic:namespace:item",
  shop: "epic",
  objectId: "namespace:item",
  title: "Preferred title",
  iconUrl: "steam-icon",
  libraryHeroImageUrl: "steam-hero",
  logoImageUrl: "steam-logo",
  remoteId: "remote-epic",
  download: null,
  isDeleted: false,
  lastTimePlayed: null,
  playTimeInMilliseconds: 1000,
  epicPlayTimeInMilliseconds: 3000,
  hasActiveEpicImport: true,
  canonicalId: "canonical-game",
  catalogueGame: { shop: "steam", objectId: "123" },
  availableShops: ["steam", "epic"],
  ...overrides,
});

describe("library catalogue presentation", () => {
  it("keeps the downloading Epic member separate from the Steam operational member", () => {
    const epic = makeGame({
      download: { status: "active", progress: 0.25 } as Download,
    });
    for (const executablePath of [null, "steam.exe"]) {
      const steam = makeGame({
        id: "steam:123",
        shop: "steam",
        objectId: "123",
        executablePath,
      });
      const [group] = groupLibraryGames([steam, epic]);
      assert.equal(group.operationalGame, steam);
      assert.equal(group.downloadGame, epic);
      assert.equal(isLibraryGameDownloading(group.downloadGame), true);
      assert.equal(group.catalogueGame.shop, "steam");
    }
    assert.equal(epic.download?.progress, 0.25);
  });

  it("follows queue, pause, extraction and completion without changing the launch member", () => {
    const steam = makeGame({
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      executablePath: "steam.exe",
    });
    for (const status of [
      "active",
      "waiting",
      "paused",
      "error",
      "extracting",
    ] as DownloadStatus[]) {
      const epic = makeGame({ download: { status } as Download });
      const [group] = groupLibraryGames([epic, steam]);
      assert.equal(group.operationalGame, steam);
      assert.equal(group.downloadGame, epic);
      assert.equal(
        isLibraryGameDownloading(epic),
        status === "active" || status === "extracting"
      );
    }
    for (const download of [
      { status: "paused", queued: true } as Download,
      { status: "complete", extracting: true } as Download,
    ]) {
      assert.equal(
        groupLibraryGames([steam, makeGame({ download })])[0].downloadGame.shop,
        "epic"
      );
    }
    const epic = makeGame({
      download: { status: "complete", extracting: false } as Download,
    });
    assert.equal(groupLibraryGames([steam, epic])[0].downloadGame, steam);
    assert.equal(
      groupLibraryGames(
        [steam, makeGame({ download: { status: "active" } as Download })],
        [steam.id]
      )[0].operationalGame,
      steam
    );
  });

  it("keeps legacy collection membership for single games and linked store groups", () => {
    const legacy = { ...makeGame(), collectionId: "old" };
    const steam = makeGame({
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      collectionIds: ["modern"],
    });
    assert.deepEqual(groupLibraryGames([legacy])[0].collectionIds, ["old"]);
    assert.deepEqual(groupLibraryGames([legacy, steam])[0].collectionIds, [
      "old",
      "modern",
    ]);
    assert.deepEqual(
      groupLibraryGames([{ ...legacy, collectionIds: [] }])[0].collectionIds,
      []
    );
    assert.equal(legacy.collectionIds, undefined);
  });

  it("presents an Epic-only import as Steam without inventing a Steam member", () => {
    const epic = makeGame();
    const [presentation] = groupLibraryGames([epic]);
    assert.deepEqual(presentation.catalogueGame, {
      shop: "steam",
      objectId: "123",
    });
    assert.deepEqual(presentation.availableShops, ["steam", "epic"]);
    assert.equal(presentation.shop, "epic");
    assert.equal(presentation.objectId, epic.objectId);
    assert.equal(presentation.operationalGame, epic);
    assert.deepEqual(presentation.members, [epic]);
    assert.equal(presentation.iconUrl, "steam-icon");
    assert.equal(
      findLibraryGamePresentation([epic], { shop: "steam", objectId: "123" })
        ?.operationalGame,
      epic
    );
  });

  it("sums distinct members for reading without modifying persisted Hydra time", () => {
    const epic = makeGame({
      executablePath: "epic.exe",
      customIconUrl: "custom-icon",
    });
    const steam = makeGame({
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      title: "Steam title",
      playTimeInMilliseconds: 2000,
      steamPlayTimeInMilliseconds: 10000,
      epicPlayTimeInMilliseconds: 0,
      hasActiveSteamImport: true,
      hasActiveEpicImport: false,
      favorite: true,
      collectionIds: ["collection"],
      lastTimePlayed: new Date("2026-10-13T12:00:00Z"),
    });
    const [presentation] = groupLibraryGames([epic, steam, { ...steam }]);
    assert.equal(presentation.operationalGame, epic);
    assert.equal(presentation.title, "Steam title");
    assert.equal(presentation.members.length, 2);
    assert.equal(getDisplayedPlayTimeInMilliseconds(presentation), 16000);
    assert.equal(presentation.customIconUrl, "custom-icon");
    assert.equal(presentation.favorite, true);
    assert.deepEqual(presentation.collectionIds, ["collection"]);
    assert.equal(presentation.lastTimePlayed, steam.lastTimePlayed);
    assert.equal(epic.playTimeInMilliseconds, 1000);
    assert.equal(steam.playTimeInMilliseconds, 2000);
  });

  it("chooses running member, executable member, then Steam, independently of display", () => {
    const epic = makeGame();
    const steam = makeGame({ id: "steam:123", shop: "steam", objectId: "123" });
    assert.equal(groupLibraryGames([epic, steam])[0].operationalGame, steam);
    assert.equal(
      groupLibraryGames([epic, steam], new Set([epic.id]))[0].operationalGame,
      epic
    );
    const installedEpic = { ...epic, executablePath: "epic.exe" };
    assert.equal(
      groupLibraryGames([installedEpic, steam])[0].operationalGame,
      installedEpic
    );
    assert.equal(
      groupLibraryGames([installedEpic, steam], [steam.id])[0].operationalGame,
      steam
    );
  });

  it("keeps Epic-only catalogue and unrelated same-title games separate", () => {
    const epic = makeGame({
      catalogueGame: { shop: "epic", objectId: "namespace:item" },
      availableShops: ["epic"],
    });
    const other = makeGame({
      id: "steam:999",
      shop: "steam",
      objectId: "999",
      canonicalId: "other",
      catalogueGame: { shop: "steam", objectId: "999" },
    });
    const old = makeGame({
      id: "steam:888",
      shop: "steam",
      objectId: "888",
      canonicalId: undefined,
      catalogueGame: undefined,
      availableShops: undefined,
    });
    const groups = groupLibraryGames([epic, other, old]);
    assert.equal(groups.length, 3);
    assert.equal(groups[0].catalogueGame.shop, "epic");
    assert.deepEqual(groups[2].catalogueGame, {
      shop: "steam",
      objectId: "888",
    });
  });

  it("keeps the surviving record after disconnect without retaining removed time", () => {
    const steam = makeGame({
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      epicPlayTimeInMilliseconds: 0,
      steamPlayTimeInMilliseconds: 2000,
    });
    const deletedEpic = makeGame({ isDeleted: true });
    const [presentation] = groupLibraryGames([deletedEpic, steam]);
    assert.deepEqual(presentation.members, [steam]);
    assert.equal(getDisplayedPlayTimeInMilliseconds(presentation), 3000);
  });

  it("keeps custom games separate and preserves a member's privacy", () => {
    const epic = makeGame({ isHiddenFromOthers: true });
    const steam = makeGame({
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      isHiddenFromOthers: false,
    });
    const custom = makeGame({
      id: "custom:local",
      shop: "custom",
      objectId: "local",
    });
    const groups = groupLibraryGames([epic, steam, custom]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].isHiddenFromOthers, true);
    assert.deepEqual(groups[1].members, [custom]);
  });

  it("groups a newly added Steam copy only through one confirmed exact catalogue identity", () => {
    const epic = makeGame();
    const newSteam = makeGame({
      id: "steam:123",
      shop: "steam",
      objectId: "123",
      canonicalId: undefined,
      catalogueGame: undefined,
      availableShops: undefined,
      epicPlayTimeInMilliseconds: 0,
    });
    const [group] = groupLibraryGames([epic, newSteam]);
    assert.equal(group.canonicalId, epic.canonicalId);
    assert.deepEqual(group.members, [epic, newSteam]);
    assert.equal(group.members[1], newSteam);
    assert.equal(group.operationalGame, newSteam);
    assert.equal(newSteam.canonicalId, undefined);
    const conflicting = makeGame({
      id: "epic:other:item",
      objectId: "other:item",
      canonicalId: "other",
    });
    assert.equal(groupLibraryGames([epic, conflicting, newSteam]).length, 3);
    assert.equal(
      findLibraryGamePresentation([epic, conflicting], {
        shop: "steam",
        objectId: "123",
      }),
      undefined
    );
  });

  it("preserves existing catalogue metadata when individual responses omit it", () => {
    const game = makeGame();
    assert.deepEqual(mergeLibraryCatalogueMetadata(game, {}), {
      canonicalId: game.canonicalId,
      catalogueGame: game.catalogueGame,
      availableShops: game.availableShops,
    });
    assert.deepEqual(
      mergeLibraryCatalogueMetadata(game, { availableShops: ["epic"] })
        .availableShops,
      ["epic"]
    );
  });
});
