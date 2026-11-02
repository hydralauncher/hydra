import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCombinedDefinitionLookup,
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
      noLocal
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
      noLocal
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
    assert.equal(presentCombinedAchievements(combined, noLocal).length, 2);
  });
  it("incorporates unsynced local unlocks only from their exact store identity", () => {
    const local = [{ name: "FIRST_WIN", unlockTime: 3 }];
    const combined = response(
      variant("steam", null, "FIRST_WIN"),
      variant("epic", 1)
    );
    const before = JSON.stringify(combined);
    const rows = presentCombinedAchievements(combined, (shop, id) =>
      shop === "steam" && id === "10" ? local : []
    );
    assert.equal(rows[0].source, "steam");
    assert.equal(rows[0].sources?.length, 2);
    assert.equal(JSON.stringify(combined), before);
    assert.deepEqual(local, [{ name: "FIRST_WIN", unlockTime: 3 }]);
  });
  it("never matches same-name local achievements from a different game", () => {
    const rows = presentCombinedAchievements(
      response(variant("steam", null)),
      (_, id) => (id === "20" ? [{ name: "First Win", unlockTime: 3 }] : [])
    );
    assert.equal(rows[0].unlocked, false);
  });
  it("keeps the description of hidden locked achievements so they can be revealed", () => {
    const combined = response({ ...variant("steam", null), hidden: true });
    const [row] = presentCombinedAchievements(combined, noLocal);
    assert.equal(row.description, "Ganhe uma vez");
    assert.equal(row.displayName, "Primeira vitória");
  });
  it("looks definitions up by name per store copy, reading each copy once", () => {
    const reads: string[] = [];
    const lookup = createCombinedDefinitionLookup((shop, objectId) => {
      reads.push(`${shop}:${objectId}`);
      return shop === "steam"
        ? [
            {
              name: "First_Win",
              displayName: "First Win",
              icon: "",
              icongray: "",
              hidden: false,
              globalUnlockPercentage: 33,
            },
          ]
        : [];
    });

    assert.equal(
      lookup("steam", "10", "FIRST_WIN")?.globalUnlockPercentage,
      33
    );
    assert.equal(
      lookup("steam", "10", "first_win")?.globalUnlockPercentage,
      33
    );
    assert.equal(lookup("steam", "10", "Other"), undefined);
    assert.equal(lookup("epic", "sandbox:item", "FIRST_WIN"), undefined);
    assert.deepEqual(reads, ["steam:10", "epic:sandbox:item"]);
  });
  it("takes the unlock rate and Steam set from the catalogue definitions", () => {
    const steamSet = { id: 2, name: "Single Player", order: 0 };
    const rows = presentCombinedAchievements(
      response(variant("steam", null), variant("epic", 1)),
      noLocal,
      (shop) =>
        shop === "steam"
          ? { globalUnlockPercentage: 40, set: steamSet }
          : { globalUnlockPercentage: 12, set: null }
    );
    assert.equal(rows[0].source, "epic");
    assert.equal(rows[0].globalUnlockPercentage, 12);
    assert.deepEqual(rows[0].set, steamSet);
  });
  it("falls back to another store's rate and leaves both empty without definitions", () => {
    const withFallback = presentCombinedAchievements(
      response(variant("steam", 1), variant("epic", null)),
      noLocal,
      (shop) =>
        shop === "epic" ? { globalUnlockPercentage: 7, set: null } : undefined
    );
    assert.equal(withFallback[0].globalUnlockPercentage, 7);
    assert.equal(withFallback[0].set, null);

    const withoutDefinitions = presentCombinedAchievements(
      response(variant("steam", 1)),
      noLocal
    );
    assert.equal(withoutDefinitions[0].globalUnlockPercentage, null);
    assert.equal(withoutDefinitions[0].set, null);
  });
});
