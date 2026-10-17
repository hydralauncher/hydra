import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import ts from "typescript";
import { mergeUnlockedAchievementLists } from "../../services/achievements/merge-unlocked-achievements.ts";
import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
} from "../../services/achievements/achievement-sync-coordinator.ts";

for (const ownerChanged of [false, true]) {
  for (const combinedAvailable of [false, true]) {
    for (const includesRequestedCopy of [false, true]) {
      it(`refreshes only the selected source cache before optional union (available=${combinedAvailable}, requestedCopy=${includesRequestedCopy}, ownerChanged=${ownerChanged})`, async () => {
        let activeOwner: string | null = "A";
        const reads: string[] = [];
        const calls: string[] = [];
        const unlocked = [{ name: "FIRST", unlockTime: 1 }];
        let cached = { unlockedAchievements: unlocked };
        const stubs: Record<string, unknown> = {
          "../register-event": { registerEvent: () => undefined },
          "@main/level": {
            db: { get: async () => null },
            levelKeys: {
              userPreferences: "preferences",
              game: (shop: string, id: string) => `${shop}:${id}`,
            },
          },
          "@main/services/hydra-api": {
            HydraApi: {
              getAuthContext: () => activeOwner,
              isAuthContextCurrent: (owner: string) => owner === activeOwner,
              get: async (
                _url: string,
                params: { shop: string; objectId: string },
                options: { timeout: number }
              ) => {
                assert.deepEqual(calls, ["catalogue", "remote", "cache"]);
                assert.deepEqual(params, {
                  shop: "steam",
                  objectId: "10",
                  language: "en",
                });
                assert.ok(options.timeout > 0 && options.timeout <= 5000);
                if (ownerChanged) activeOwner = "B";
                if (!combinedAvailable) throw new Error("timeout");
                return {
                  achievements: [
                    {
                      canonicalAchievementId: "union",
                      variants: [
                        {
                          shop: includesRequestedCopy ? "steam" : "epic",
                          objectId: includesRequestedCopy ? "10" : "epic-10",
                        },
                      ],
                    },
                  ],
                };
              },
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
              get: (shop: string, id: string) => {
                reads.push(`${shop}:${id}`);
                return cached;
              },
              set: (shop: string, id: string, value: typeof cached) => {
                assert.equal(`${shop}:${id}`, "steam:10");
                calls.push("cache");
                cached = value;
              },
            },
          },
          "@main/services/achievements/achievement-souvenir-store": {
            AchievementSouvenirStore: {
              set: () => undefined,
              invalidate: () => undefined,
            },
          },
          "@main/services/achievements/get-game-achievement-data": {
            getGameAchievementData: async () => {
              calls.push("catalogue");
              return [
                {
                  name: "FIRST",
                  displayName: "First",
                  icon: "icon",
                  icongray: "gray",
                  hidden: false,
                },
              ];
            },
          },
          "@main/services/achievements/get-achievement-souvenirs": {
            fetchRemoteUserGameAchievements: async () => {
              calls.push("remote");
              return {
                unlocked: [{ name: "STEAM_REMOTE", unlockTime: 2 }],
                achievements: [],
                souvenirs: new Map(),
              };
            },
          },
          "@main/services/achievements/merge-unlocked-achievements": {
            mergeUnlockedAchievementLists,
          },
          "@main/services/achievements/combined-achievement-presentation": {
            presentCombinedAchievements() {
              assert.ok(combinedAvailable);
              assert.ok(
                cached.unlockedAchievements.some(
                  (row) => row.name === "STEAM_REMOTE"
                )
              );
              return [{ name: "EPIC_ONLY", unlocked: true }];
            },
          },
        };
        const output = ts.transpileModule(
          readFileSync(
            new URL("./get-unlocked-achievements.ts", import.meta.url),
            "utf8"
          ),
          { compilerOptions: { module: ts.ModuleKind.CommonJS } }
        ).outputText;
        const exported = {} as {
          getUnlockedAchievements: (
            objectId: string,
            shop: string,
            cached: boolean
          ) => Promise<Array<{ name: string; unlocked: boolean }>>;
        };
        new Function("exports", "require", output)(exported, (name: string) => {
          assert.ok(name in stubs, name);
          return stubs[name];
        });
        if (ownerChanged) {
          await assert.rejects(
            exported.getUnlockedAchievements("10", "steam", true),
            AchievementSyncCancelledError
          );
          return;
        }
        const rows = await exported.getUnlockedAchievements(
          "10",
          "steam",
          true
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].unlocked, true);
        assert.equal(
          rows[0].name,
          combinedAvailable && includesRequestedCopy ? "EPIC_ONLY" : "FIRST"
        );
        assert.ok(reads.length > 0 && reads.every((key) => key === "steam:10"));
        assert.deepEqual(
          cached.unlockedAchievements.map((row) => row.name).sort(),
          ["FIRST", "STEAM_REMOTE"]
        );
      });
    }
  }
}
