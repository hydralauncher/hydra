import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { HydraManifestIndex } from "../manifest/types.ts";
import {
  __saveManifestDependencies,
  getSaveRulesForGame,
} from "../save-manifest.ts";

const manifestIndex: HydraManifestIndex = {
  version: 1,
  fetchedAt: Date.now(),
  sourceUrl: "https://cdn.losbroxas.org/manifest.yaml",
  games: {
    "1687950": {
      manifestKey: "1687950",
      files: [
        {
          rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
          tags: ["save"],
          when: [{ os: "windows", store: "steam" }],
        },
        {
          rawPath: "<base>/save/",
          tags: ["save"],
          when: [],
        },
        {
          rawPath: "<base>/valve/*.cfg",
          tags: ["config"],
          when: [],
        },
        {
          rawPath: "<base>/settings.ini",
          tags: ["config"],
          when: [],
        },
      ],
    },
  },
};

describe("getSaveRulesForGame", () => {
  it("returns manifestKey and mapped rules when a game entry is found", async () => {
    const originalGetHydraManifestIndex =
      __saveManifestDependencies.getHydraManifestIndex;
    const originalFindManifestEntryForGame =
      __saveManifestDependencies.findManifestEntryForGame;

    __saveManifestDependencies.getHydraManifestIndex = (async () =>
      manifestIndex) as typeof __saveManifestDependencies.getHydraManifestIndex;
    __saveManifestDependencies.findManifestEntryForGame = (async () =>
      manifestIndex.games[
        "1687950"
      ]) as typeof __saveManifestDependencies.findManifestEntryForGame;

    try {
      const result = await getSaveRulesForGame("steam", "1687950");

      assert.deepEqual(result, {
        gameId: { shop: "steam", objectId: "1687950" },
        manifestKey: "1687950",
        rules: [
          {
            kind: "dir",
            rawPath: "<winAppData>/SEGA/P5R/Steam/<storeUserId>/savedata",
            source: "ludusavi",
            tags: ["save"],
            when: [{ os: "windows", store: "steam" }],
          },
          {
            kind: "dir",
            rawPath: "<base>/save/",
            source: "ludusavi",
            tags: ["save"],
            when: [],
          },
          {
            kind: "file",
            rawPath: "<base>/valve/*.cfg",
            source: "ludusavi",
            tags: ["config"],
            when: [],
          },
          {
            kind: "file",
            rawPath: "<base>/settings.ini",
            source: "ludusavi",
            tags: ["config"],
            when: [],
          },
        ],
      });
    } finally {
      __saveManifestDependencies.getHydraManifestIndex =
        originalGetHydraManifestIndex;
      __saveManifestDependencies.findManifestEntryForGame =
        originalFindManifestEntryForGame;
    }
  });

  it("returns an empty result when no manifest entry is found", async () => {
    const originalGetHydraManifestIndex =
      __saveManifestDependencies.getHydraManifestIndex;
    const originalFindManifestEntryForGame =
      __saveManifestDependencies.findManifestEntryForGame;

    __saveManifestDependencies.getHydraManifestIndex = (async () =>
      manifestIndex) as typeof __saveManifestDependencies.getHydraManifestIndex;
    __saveManifestDependencies.findManifestEntryForGame = (async () =>
      null) as typeof __saveManifestDependencies.findManifestEntryForGame;

    try {
      const result = await getSaveRulesForGame("steam", "missing-game");

      assert.deepEqual(result, {
        gameId: { shop: "steam", objectId: "missing-game" },
        manifestKey: null,
        rules: [],
      });
    } finally {
      __saveManifestDependencies.getHydraManifestIndex =
        originalGetHydraManifestIndex;
      __saveManifestDependencies.findManifestEntryForGame =
        originalFindManifestEntryForGame;
    }
  });
});
