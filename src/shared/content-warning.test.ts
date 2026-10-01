import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSteamContentWarning,
  shouldHideGameForAdultContent,
} from "./content-warning.js";

describe("getSteamContentWarning", () => {
  it("returns none for a game with no descriptors", () => {
    assert.deepEqual(getSteamContentWarning([]), {
      level: "none",
      minimumAge: null,
      reasons: [],
      source: "steam",
    });
  });

  it("treats a missing ids array the same as empty", () => {
    assert.equal(getSteamContentWarning(null).level, "none");
    assert.equal(getSteamContentWarning(undefined).level, "none");
  });

  it("marks adult-only sexual content as adult, regardless of other descriptors", () => {
    const warning = getSteamContentWarning([2, 3]);
    assert.equal(warning.level, "adult");
    assert.equal(warning.minimumAge, 18);
    assert.deepEqual(warning.reasons, ["sexual_content"]);
  });

  it("marks non-adult descriptors as mature with mapped reasons", () => {
    const nudity = getSteamContentWarning([1]);
    assert.equal(nudity.level, "mature");
    assert.deepEqual(nudity.reasons, ["nudity"]);

    const generalMature = getSteamContentWarning([5]);
    assert.equal(generalMature.level, "mature");
    assert.deepEqual(generalMature.reasons, ["age_restricted"]);
  });

  it("still marks mature when a descriptor has no reason mapping (e.g. violence)", () => {
    const violence = getSteamContentWarning([2]);
    assert.equal(violence.level, "mature");
    assert.deepEqual(violence.reasons, []);
  });
});

describe("shouldHideGameForAdultContent", () => {
  it("never hides when the preference is off", () => {
    const game = {
      contentWarning: {
        level: "adult" as const,
        minimumAge: 18,
        reasons: [],
        source: "steam" as const,
      },
    };
    assert.equal(shouldHideGameForAdultContent(game, false), false);
    assert.equal(shouldHideGameForAdultContent(game, undefined), false);
  });

  it("hides only adult-level games when the preference is on", () => {
    const adult = {
      contentWarning: {
        level: "adult" as const,
        minimumAge: 18,
        reasons: [],
        source: "steam" as const,
      },
    };
    const mature = {
      contentWarning: {
        level: "mature" as const,
        minimumAge: null,
        reasons: [],
        source: "steam" as const,
      },
    };
    const none = {
      contentWarning: {
        level: "none" as const,
        minimumAge: null,
        reasons: [],
        source: "steam" as const,
      },
    };

    assert.equal(shouldHideGameForAdultContent(adult, true), true);
    assert.equal(shouldHideGameForAdultContent(mature, true), false);
    assert.equal(shouldHideGameForAdultContent(none, true), false);
  });

  it("never hides a game with no content warning data, even with the preference on", () => {
    assert.equal(
      shouldHideGameForAdultContent({ contentWarning: undefined }, true),
      false
    );
    assert.equal(shouldHideGameForAdultContent({}, true), false);
  });
});
