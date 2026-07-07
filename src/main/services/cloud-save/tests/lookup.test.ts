import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { gamesSublevel, levelKeys } from "@main/level";
import type { HydraManifestIndex } from "../manifest/types.ts";
import { findManifestEntryForGame } from "../manifest/lookup.ts";

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
      ],
    },
    Persona5Royal: {
      manifestKey: "Persona5Royal",
      files: [
        {
          rawPath: "<base>/save",
          tags: ["save"],
          when: [],
        },
      ],
    },
  },
};

describe("findManifestEntryForGame", () => {
  const gameKey = levelKeys.game("steam", "1687950");

  beforeEach(async () => {
    await gamesSublevel.put(gameKey, {
      title: "Persona 5 Royal",
      iconUrl: null,
      libraryHeroImageUrl: null,
      logoImageUrl: null,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      objectId: "1687950",
      shop: "steam",
      remoteId: null,
      isDeleted: false,
    });
  });

  afterEach(async () => {
    await gamesSublevel.del(gameKey).catch(() => undefined);
  });

  it("finds the entry by objectId first", async () => {
    const entry = await findManifestEntryForGame(
      manifestIndex,
      "steam",
      "1687950"
    );

    assert.equal(entry?.manifestKey, "1687950");
  });

  it("finds the entry by remoteId when objectId does not match", async () => {
    await gamesSublevel.put(gameKey, {
      title: "Different title",
      iconUrl: null,
      libraryHeroImageUrl: null,
      logoImageUrl: null,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      objectId: "1687950",
      shop: "steam",
      remoteId: "Persona5Royal",
      isDeleted: false,
    });

    const entry = await findManifestEntryForGame(
      {
        ...manifestIndex,
        games: {
          Persona5Royal: manifestIndex.games.Persona5Royal,
        },
      },
      "steam",
      "1687950"
    );

    assert.equal(entry?.manifestKey, "Persona5Royal");
  });

  it("finds the entry by normalized title when objectId and remoteId do not match", async () => {
    const entry = await findManifestEntryForGame(
      {
        ...manifestIndex,
        games: {
          Persona5Royal: manifestIndex.games.Persona5Royal,
        },
      },
      "steam",
      "unknown-object-id"
    );

    assert.equal(entry?.manifestKey, "Persona5Royal");
  });

  it("returns null when no match is found", async () => {
    const entry = await findManifestEntryForGame(
      {
        ...manifestIndex,
        games: {
          AnotherGame: {
            manifestKey: "AnotherGame",
            files: [],
          },
        },
      },
      "steam",
      "missing-game"
    );

    assert.equal(entry, null);
  });

  it("still tries objectId when the game is missing locally", async () => {
    await gamesSublevel.del(gameKey).catch(() => undefined);

    const entry = await findManifestEntryForGame(
      manifestIndex,
      "steam",
      "1687950"
    );

    assert.equal(entry?.manifestKey, "1687950");
  });
});
