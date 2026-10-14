import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import ts from "typescript";

it("bounds the optional union request and falls back to the exact selected copy", async () => {
  const reads: string[] = [];
  const unlocked = [{ name: "FIRST", unlockTime: 1 }];
  const stubs: Record<string, unknown> = {
    "../register-event": { registerEvent: () => undefined },
    "@main/level": {
      db: { get: async () => null },
      levelKeys: { userPreferences: "preferences" },
    },
    "@main/services/hydra-api": {
      HydraApi: {
        get: async (
          _url: string,
          params: { shop: string; objectId: string },
          options: { timeout: number }
        ) => {
          assert.deepEqual(params, {
            shop: "steam",
            objectId: "10",
            language: "en",
          });
          assert.ok(options.timeout > 0 && options.timeout <= 5000);
          throw new Error("timeout");
        },
      },
    },
    "@main/services/achievements/achievement-watcher-manager": {
      AchievementWatcherManager: {},
    },
    "@main/services/achievements/achievement-memory-store": {
      AchievementMemoryStore: {
        get: (shop: string, id: string) => {
          reads.push(`${shop}:${id}`);
          return { unlockedAchievements: unlocked };
        },
        set: (shop: string, id: string) => {
          assert.equal(`${shop}:${id}`, "steam:10");
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
      getGameAchievementData: async () => [
        {
          name: "FIRST",
          displayName: "First",
          icon: "icon",
          icongray: "gray",
          hidden: false,
        },
      ],
    },
    "@main/services/achievements/get-achievement-souvenirs": {
      fetchRemoteUserGameAchievements: async () => ({
        unlocked: [],
        achievements: [],
        souvenirs: new Map(),
      }),
    },
    "@main/services/achievements/merge-unlocked-achievements": {
      mergeUnlockedAchievementLists: (_remote: unknown, local: unknown) =>
        local,
    },
    "@main/services/achievements/combined-achievement-presentation": {
      presentCombinedAchievements() {
        throw new Error("Unexpected combined presentation");
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
    ) => Promise<Array<{ unlocked: boolean }>>;
  };
  new Function("exports", "require", output)(exported, (name: string) => {
    assert.ok(name in stubs, name);
    return stubs[name];
  });
  const rows = await exported.getUnlockedAchievements("10", "steam", true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unlocked, true);
  assert.ok(reads.length > 0 && reads.every((key) => key === "steam:10"));
});
