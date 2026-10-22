import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRankTier, isMedalTier } from "./rank-tier.js";

describe("getRankTier", () => {
  it("gives the podium gold, silver and bronze", () => {
    assert.equal(getRankTier(1), "gold");
    assert.equal(getRankTier(2), "silver");
    assert.equal(getRankTier(3), "bronze");
  });

  it("accents ranks 4 to 10 and leaves the rest plain", () => {
    assert.equal(getRankTier(4), "top10");
    assert.equal(getRankTier(10), "top10");
    assert.equal(getRankTier(11), "default");
  });

  it("treats invalid ranks as plain", () => {
    assert.equal(getRankTier(0), "default");
    assert.equal(getRankTier(-1), "default");
    assert.equal(getRankTier(1.5), "default");
    assert.equal(getRankTier(Number.NaN), "default");
  });
});

describe("isMedalTier", () => {
  it("only matches podium tiers", () => {
    assert.equal(isMedalTier("gold"), true);
    assert.equal(isMedalTier("bronze"), true);
    assert.equal(isMedalTier("top10"), false);
    assert.equal(isMedalTier("default"), false);
  });
});
