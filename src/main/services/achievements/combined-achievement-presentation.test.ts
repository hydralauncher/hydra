import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  presentCombinedAchievements,
  type CombinedAchievementVariant,
  type CombinedAchievements,
} from "./combined-achievement-presentation.ts";
const variant = (
  shop: "steam" | "epic",
  unlockTime: number | null,
  name = "First Win"
): CombinedAchievementVariant => ({
  shop,
  objectId: shop === "steam" ? "10" : "sandbox:item",
  name,
  displayName: shop === "steam" ? "Primeira vitória" : "Primeira Vitória!",
  description: "Ganhe uma vez",
  hidden: false,
  icon: shop,
  icongray: "gray",
  unlockTime,
  imageUrl: null,
});
const response = (
  ...variants: CombinedAchievementVariant[]
): CombinedAchievements => ({
  canonicalId: "game",
  achievements: [{ canonicalAchievementId: "achievement", variants }],
});
const noLocal = () => [];
describe("combined achievement presentation", () => {
  it("shows one Steam entry when both stores unlocked an equivalent achievement", () => {
    const rows = presentCombinedAchievements(
      response(variant("epic", 1), variant("steam", 2)),
      noLocal,
      false
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "steam");
    assert.equal(rows[0].displayName, "Primeira vitória");
    assert.equal(rows[0].unlockTime, 2);
    assert.equal(rows[0].sources?.length, 2);
  });
  it("shows Epic when only Epic unlocked it, without claiming Steam unlocked it", () => {
    const rows = presentCombinedAchievements(
      response(variant("steam", null), variant("epic", 1)),
      noLocal,
      false
    );
    assert.equal(rows[0].source, "epic");
    assert.equal(rows[0].sources?.length, 1);
    assert.equal(rows[0].icon, "epic");
  });
  it("shows the union of different achievements from both stores", () => {
    const combined = response(variant("steam", 1));
    combined.achievements.push({
      canonicalAchievementId: "other",
      variants: [variant("epic", 2, "Other")],
    });
    assert.equal(
      presentCombinedAchievements(combined, noLocal, false).length,
      2
    );
  });
  it("incorporates unsynced local unlocks only from their exact store identity", () => {
    const local = [{ name: "FIRST_WIN", unlockTime: 3 }];
    const combined = response(
      variant("steam", null, "FIRST_WIN"),
      variant("epic", 1)
    );
    const before = JSON.stringify(combined);
    const rows = presentCombinedAchievements(
      combined,
      (shop, id) => (shop === "steam" && id === "10" ? local : []),
      false
    );
    assert.equal(rows[0].source, "steam");
    assert.equal(rows[0].sources?.length, 2);
    assert.equal(JSON.stringify(combined), before);
    assert.deepEqual(local, [{ name: "FIRST_WIN", unlockTime: 3 }]);
  });
  it("never matches same-name local achievements from a different game", () => {
    const rows = presentCombinedAchievements(
      response(variant("steam", null)),
      (_, id) => (id === "20" ? [{ name: "First Win", unlockTime: 3 }] : []),
      false
    );
    assert.equal(rows[0].unlocked, false);
  });
  it("keeps hidden locked descriptions hidden and preserves original display names", () => {
    const combined = response({ ...variant("steam", null), hidden: true });
    assert.equal(
      presentCombinedAchievements(combined, noLocal, false)[0].description,
      undefined
    );
    assert.equal(
      presentCombinedAchievements(combined, noLocal, true)[0].description,
      "Ganhe uma vez"
    );
  });
});
