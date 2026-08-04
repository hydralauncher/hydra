import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamAchievement } from "@types";

import { buildAchievementMetadata } from "./build-achievement-metadata.js";

const ICON_BASE = "https://cdn.example.com/images/apps/2124490";

const achievement = (
  overrides: Partial<SteamAchievement> = {}
): SteamAchievement => ({
  name: "TryToLeaveObservationDeck",
  displayName: "No Turning Back Now",
  description: "Try to leave Silent Hill in the Observation Deck area.",
  icon: `${ICON_BASE}/67dd901271e56a7dc1230e9c0411cf598cdd32a2.jpg`,
  icongray: `${ICON_BASE}/b745b6c86e4a4d495c1c97024f4b95117e1c4bc3.jpg`,
  hidden: true,
  ...overrides,
});

describe("buildAchievementMetadata", () => {
  it("emits the shape emulators read from steam_settings", () => {
    const { entries } = buildAchievementMetadata([achievement()]);

    assert.deepEqual(entries, [
      {
        description: "Try to leave Silent Hill in the Observation Deck area.",
        displayName: "No Turning Back Now",
        hidden: 1,
        icon: "images/1.jpg",
        icongray: "images/1_gray.jpg",
        name: "TryToLeaveObservationDeck",
      },
    ]);
  });

  it("numbers icons by achievement position", () => {
    const { entries } = buildAchievementMetadata([
      achievement({ name: "First" }),
      achievement({ name: "Second" }),
      achievement({ name: "Third" }),
    ]);

    assert.deepEqual(
      entries.map(({ icon, icongray }) => [icon, icongray]),
      [
        ["images/1.jpg", "images/1_gray.jpg"],
        ["images/2.jpg", "images/2_gray.jpg"],
        ["images/3.jpg", "images/3_gray.jpg"],
      ]
    );
  });

  it("pairs every entry with its two downloads", () => {
    const { icons } = buildAchievementMetadata([
      achievement({ name: "First" }),
      achievement({ name: "Second" }),
    ]);

    assert.deepEqual(
      icons.map(({ fileName }) => fileName),
      ["1.jpg", "1_gray.jpg", "2.jpg", "2_gray.jpg"]
    );
  });

  it("writes hidden as a number", () => {
    const { entries } = buildAchievementMetadata([
      achievement({ hidden: false }),
    ]);

    assert.equal(entries[0].hidden, 0);
  });

  it("falls back to the colored icon when there is no gray icon", () => {
    const { entries, icons } = buildAchievementMetadata([
      achievement({ icongray: `${ICON_BASE}/` }),
    ]);

    assert.equal(entries[0].icongray, "images/1_gray.jpg");
    assert.equal(icons[0].url, icons[1].url);
  });

  it("keeps missing descriptions as empty strings", () => {
    const { entries } = buildAchievementMetadata([
      achievement({ description: undefined }),
    ]);

    assert.equal(entries[0].description, "");
  });

  it("skips achievements without an api name", () => {
    const { entries, icons } = buildAchievementMetadata([
      achievement({ name: "" }),
      achievement({ name: "Kept" }),
    ]);

    assert.deepEqual(
      entries.map(({ name }) => name),
      ["Kept"]
    );
    assert.deepEqual(
      icons.map(({ fileName }) => fileName),
      ["1.jpg", "1_gray.jpg"]
    );
  });

  it("never lets a url decide a file name", () => {
    const { entries } = buildAchievementMetadata([
      achievement({
        icon: "https://cdn.example.com/a/..%2F..%2Fevil.exe",
        icongray: "not a url",
      }),
    ]);

    assert.equal(entries[0].icon, "images/1.jpg");
    assert.equal(entries[0].icongray, "images/1_gray.jpg");
  });

  it("keeps a safe extension from the url", () => {
    const { entries } = buildAchievementMetadata([
      achievement({
        icon: `${ICON_BASE}/abc.png`,
        icongray: `${ICON_BASE}/abc_gray.PNG`,
      }),
    ]);

    assert.equal(entries[0].icon, "images/1.png");
    assert.equal(entries[0].icongray, "images/1_gray.png");
  });
});
