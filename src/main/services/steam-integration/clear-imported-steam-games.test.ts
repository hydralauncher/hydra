import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  collectSteamOnlyObjectIds,
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

  it("keeps steam-imported games that were later installed locally", () => {
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
      false
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
      false
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
