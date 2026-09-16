import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  collectSteamOnlyObjectIds,
  getSteamImportedDataCleanup,
  hasImportedSteamData,
  shouldRemoveImportedSteamGame,
} from "./steam-imported-games.ts";

describe("shouldRemoveImportedSteamGame", () => {
  const steamOnly = new Set(["620"]);

  it("removes steam-only rows even without an executable", () => {
    assert.equal(
      shouldRemoveImportedSteamGame(
        { shop: "steam", isDeleted: false, objectId: "620", source: "steam" },
        steamOnly
      ),
      true
    );
  });

  it("keeps hydra-added steam shop games that are not in the steam-only list", () => {
    assert.equal(
      shouldRemoveImportedSteamGame(
        { shop: "steam", isDeleted: false, objectId: "220", source: "hydra" },
        steamOnly
      ),
      false
    );
  });

  it("removes untagged local steam games that the API listed as source steam", () => {
    assert.equal(
      shouldRemoveImportedSteamGame(
        { shop: "steam", isDeleted: false, objectId: "620", source: undefined },
        steamOnly
      ),
      true
    );
  });

  it("removes steam-only rows after automatic executable linking", () => {
    assert.equal(
      shouldRemoveImportedSteamGame(
        {
          shop: "steam",
          isDeleted: false,
          objectId: "620",
          source: "steam",
          executablePath: "/games/portal.exe",
        },
        steamOnly
      ),
      true
    );
    assert.equal(
      shouldRemoveImportedSteamGame(
        {
          shop: "steam",
          isDeleted: false,
          objectId: "620",
          source: "steam",
          installedSizeInBytes: 12_000_000_000,
        },
        steamOnly
      ),
      true
    );
    assert.equal(
      shouldRemoveImportedSteamGame(
        {
          shop: "steam",
          isDeleted: false,
          objectId: "620",
          source: "steam",
          trackingExecutablePaths: ["/games/portal.exe"],
        },
        steamOnly
      ),
      true
    );
  });

  it("keeps locally installed games that are not steam-only", () => {
    assert.equal(
      shouldRemoveImportedSteamGame(
        {
          shop: "steam",
          isDeleted: false,
          objectId: "220",
          source: "steam",
          executablePath: "/games/half-life.exe",
        },
        steamOnly
      ),
      false
    );
  });

  it("keeps steam-imported games that later gained Hydra playtime", () => {
    assert.equal(
      shouldRemoveImportedSteamGame(
        {
          shop: "steam",
          isDeleted: false,
          objectId: "620",
          source: "steam",
          playTimeInMilliseconds: 20 * 60 * 1000,
        },
        steamOnly
      ),
      false
    );
  });

  it("keeps launchbox and already deleted games", () => {
    assert.equal(
      shouldRemoveImportedSteamGame(
        {
          shop: "launchbox",
          isDeleted: false,
          objectId: "620",
          source: "steam",
        },
        steamOnly
      ),
      false
    );
    assert.equal(
      shouldRemoveImportedSteamGame(
        { shop: "steam", isDeleted: true, objectId: "620", source: "steam" },
        steamOnly
      ),
      false
    );
  });
});

describe("Steam imported data cleanup", () => {
  it("recognizes active, stale, and server-confirmed Steam data", () => {
    assert.equal(
      hasImportedSteamData(
        {
          shop: "steam",
          isDeleted: false,
          objectId: "10",
          hasActiveSteamImport: true,
        },
        new Set()
      ),
      true
    );
    assert.equal(
      hasImportedSteamData(
        {
          shop: "steam",
          isDeleted: false,
          objectId: "20",
          steamPlayTimeInMilliseconds: 60_000,
        },
        new Set()
      ),
      true
    );
    assert.equal(
      hasImportedSteamData(
        { shop: "steam", isDeleted: false, objectId: "620" },
        new Set(["620"])
      ),
      true
    );
    assert.equal(
      hasImportedSteamData(
        { shop: "steam", isDeleted: false, objectId: "30", source: "hydra" },
        new Set()
      ),
      false
    );
  });

  it("clears Steam state before restoring Hydra data from the remote merge", () => {
    assert.deepEqual(
      getSteamImportedDataCleanup({
        shop: "steam",
        isDeleted: false,
        objectId: "620",
        source: "steam",
        hasActiveSteamImport: true,
        steamPlayTimeInMilliseconds: 600_000,
      }),
      {
        hasActiveSteamImport: false,
        steamPlayTimeInMilliseconds: 0,
        lastTimePlayed: null,
        source: "hydra",
      }
    );
  });
});

describe("collectSteamOnlyObjectIds", () => {
  it("keeps only API rows with source steam", () => {
    assert.deepEqual(
      collectSteamOnlyObjectIds([
        { objectId: "620", source: "steam" },
        { objectId: "220", source: "hydra" },
        { objectId: "400", source: null },
      ]),
      ["620"]
    );
  });
});
