import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  collectSteamOnlyObjectIds,
  getSteamImportedDataCleanupPlan,
  hasImportedSteamData,
  shouldRemoveImportedSteamGame,
} from "./steam-imported-games.ts";

const ONE_MINUTE_IN_MILLISECONDS = 60_000;
const TEN_MINUTES_IN_MILLISECONDS = 600_000;

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
          steamPlayTimeInMilliseconds: ONE_MINUTE_IN_MILLISECONDS,
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

  it("keeps the import marker until remote cleanup is reconciled", () => {
    assert.deepEqual(
      getSteamImportedDataCleanupPlan({
        shop: "steam",
        isDeleted: false,
        objectId: "620",
        source: "steam",
        hasActiveSteamImport: true,
        steamPlayTimeInMilliseconds: TEN_MINUTES_IN_MILLISECONDS,
      }),
      {
        cleanup: {
          hasActiveSteamImport: true,
          steamPlayTimeInMilliseconds: 0,
          lastTimePlayed: null,
          source: "hydra",
        },
        lastTimePlayedFallback: null,
      }
    );
  });

  it("keeps a Hydra session fallback when imported cleanup cannot merge", () => {
    const hydraLastTimePlayed = new Date("2026-09-15T12:00:00.000Z");

    const cleanupPlan = getSteamImportedDataCleanupPlan({
      shop: "steam",
      isDeleted: false,
      objectId: "220",
      source: "hydra",
      hasActiveSteamImport: true,
      steamPlayTimeInMilliseconds: TEN_MINUTES_IN_MILLISECONDS,
      playTimeInMilliseconds: ONE_MINUTE_IN_MILLISECONDS,
      lastTimePlayed: hydraLastTimePlayed,
    });

    assert.equal(cleanupPlan.cleanup.lastTimePlayed, null);
    assert.equal(cleanupPlan.lastTimePlayedFallback, hydraLastTimePlayed);
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
