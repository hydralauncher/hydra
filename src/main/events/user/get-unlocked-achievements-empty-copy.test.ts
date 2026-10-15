import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import ts from "typescript";
import { presentCombinedAchievements } from "../../services/achievements/combined-achievement-presentation.ts";
import { mergeUnlockedAchievementLists } from "../../services/achievements/merge-unlocked-achievements.ts";
import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
} from "../../services/achievements/achievement-sync-coordinator.ts";

for (const scenario of [
  {
    name: "failed local lookup",
    canonicalId: "group",
    localGroup: "group",
    unlocked: false,
    accepts: false,
  },
  {
    name: "confirmed empty copy",
    canonicalId: "group",
    localGroup: "group",
    unlocked: false,
    accepts: true,
  },
  {
    name: "different canonical group",
    canonicalId: "group",
    localGroup: "other",
    unlocked: false,
    accepts: false,
  },
  {
    name: "unknown local group",
    canonicalId: "group",
    localGroup: undefined,
    unlocked: false,
    accepts: false,
  },
  {
    name: "unknown remote group",
    canonicalId: null,
    localGroup: "group",
    unlocked: false,
    accepts: false,
  },
  {
    name: "omitted copy with local progress",
    canonicalId: "group",
    localGroup: "group",
    unlocked: true,
    accepts: false,
  },
]) {
  it(`handles an Epic-only union for ${scenario.name}`, async () => {
    const local = {
      achievements: [],
      unlockedAchievements: scenario.unlocked
        ? [{ name: "STEAM_ONLY", unlockTime: 123 }]
        : [],
    };
    const stubs: Record<string, unknown> = {
      "../register-event": { registerEvent: () => {} },
      "@main/level": {
        db: { get: async () => null },
        levelKeys: {
          userPreferences: "preferences",
          game: (shop: string, id: string) => `${shop}:${id}`,
        },
        gamesSublevel: {
          get: async (key: string) => {
            assert.equal(key, "steam:10");
            if (scenario.name === "failed local lookup")
              throw Error("unavailable");
            return { canonicalId: scenario.localGroup };
          },
        },
      },
      "@main/services/hydra-api": {
        HydraApi: {
          getAuthContext: () => null,
          get: async () => ({
            canonicalId: scenario.canonicalId,
            achievements: [
              {
                canonicalAchievementId: "first",
                variants: [
                  {
                    shop: "epic",
                    objectId: "epic-game",
                    name: "EPIC_ONLY",
                    displayName: "Epic only",
                    hidden: false,
                    icon: "icon",
                    icongray: "gray",
                    unlockTime: 456,
                    imageUrl: null,
                  },
                ],
              },
            ],
          }),
        },
      },
      "@main/services/achievements/achievement-sync-coordinator": {
        achievementSyncCoordinator,
        AchievementSyncCancelledError,
      },
      "@main/services/achievements/achievement-watcher-manager": {
        AchievementWatcherManager: {},
      },
      "@main/services/achievements/achievement-memory-store": {
        AchievementMemoryStore: {
          get: (shop: string, id: string) =>
            shop === "steam" && id === "10" ? local : undefined,
          set: (shop: string, id: string, value: typeof local) => {
            assert.equal(`${shop}:${id}`, "steam:10");
            assert.deepEqual(
              value.unlockedAchievements,
              local.unlockedAchievements
            );
          },
        },
      },
      "@main/services/achievements/achievement-souvenir-store": {
        AchievementSouvenirStore: { set: () => {}, invalidate: () => {} },
      },
      "@main/services/achievements/get-game-achievement-data": {
        getGameAchievementData: async () => [],
      },
      "@main/services/achievements/get-achievement-souvenirs": {
        fetchRemoteUserGameAchievements: async () => ({
          unlocked: [],
          achievements: [],
          souvenirs: new Map(),
        }),
      },
      "@main/services/achievements/merge-unlocked-achievements": {
        mergeUnlockedAchievementLists,
      },
      "@main/services/achievements/combined-achievement-presentation": {
        presentCombinedAchievements,
      },
    };
    const output = ts.transpileModule(
      readFileSync(
        new URL("./get-unlocked-achievements.ts", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }
    ).outputText;
    const exported = {} as {
      getUnlockedAchievements: (
        id: string,
        shop: string,
        cached: boolean
      ) => Promise<Array<{ name: string; unlocked: boolean }>>;
    };
    new Function("exports", "require", output)(exported, (name: string) => {
      assert.ok(name in stubs, name);
      return stubs[name];
    });
    const rows = await exported.getUnlockedAchievements("10", "steam", true);
    assert.equal(rows.length, scenario.accepts ? 1 : 0);
    if (scenario.accepts) {
      assert.equal(rows[0].name, "EPIC_ONLY");
      assert.equal(rows[0].unlocked, true);
    }
  });
}
