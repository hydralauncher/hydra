import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import ts from "typescript";

for (const linked of [false, true]) {
  for (const remoteAvailable of [false, true]) {
    it(`shows locked catalogue definitions for empty Epic copy (linked=${linked}, remote=${remoteAvailable})`, async () => {
      const reads: string[] = [];
      const writes: string[] = [];
      const stubs: Record<string, unknown> = {
        "../register-event": { registerEvent: () => undefined },
        "@main/level": {
          db: { get: async () => null },
          levelKeys: {
            userPreferences: "preferences",
            game: () => "epic:game",
          },
          gamesSublevel: {
            get: async () => ({
              catalogueGame: linked
                ? { shop: "steam", objectId: "752590" }
                : undefined,
            }),
          },
        },
        "@main/services/hydra-api": {
          HydraApi: {
            getAuthContext: () => null,
            get: async () => {
              throw Error("optional union unavailable");
            },
          },
        },
        "@main/services/achievements/achievement-watcher-manager": {
          AchievementWatcherManager: {},
        },
        "@main/services/achievements/achievement-memory-store": {
          AchievementMemoryStore: {
            get: () => undefined,
            set: () => assert.fail("must not copy catalogue cache"),
          },
        },
        "@main/services/achievements/achievement-souvenir-store": {
          AchievementSouvenirStore: {
            set: (shop: string) => writes.push(shop),
          },
        },
        "@main/services/achievements/get-game-achievement-data": {
          getGameAchievementData: async (id: string, shop: string) => {
            reads.push(`${shop}:${id}`);
            return shop === "steam"
              ? [
                  {
                    name: "FIRST",
                    displayName: "First",
                    hidden: true,
                    description: "secret",
                    icon: "icon",
                    icongray: "gray/",
                  },
                  {
                    name: "SECOND",
                    displayName: "Second",
                    hidden: false,
                    description: "visible",
                    icon: "icon2",
                    icongray: "gray2",
                  },
                ]
              : [];
          },
        },
        "@main/services/achievements/get-achievement-souvenirs": {
          fetchRemoteUserGameAchievements: async () => {
            if (!remoteAvailable) throw Error("Epic disconnected");
            return { unlocked: [], achievements: [], souvenirs: new Map() };
          },
        },
        "@main/services/achievements/merge-unlocked-achievements": {
          mergeUnlockedAchievementLists: () => [],
        },
        "@main/services/achievements/combined-achievement-presentation": {},
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
          id: string,
          shop: string,
          cached: boolean
        ) => Promise<
          Array<{
            name: string;
            unlocked: boolean;
            unlockTime: number | null;
            description?: string;
            icongray: string;
          }>
        >;
      };
      new Function("exports", "require", output)(exported, (name: string) => {
        assert.ok(name in stubs, name);
        return stubs[name];
      });
      const rows = await exported.getUnlockedAchievements("game", "epic", true);
      assert.equal(rows.length, linked ? 2 : 0);
      assert.deepEqual(
        reads,
        linked ? ["epic:game", "steam:752590"] : ["epic:game"]
      );
      assert.deepEqual(writes, ["epic"]);
      if (linked) {
        assert.deepEqual(
          rows.map((row) => row.name),
          ["SECOND", "FIRST"]
        );
        assert.ok(
          rows.every((row) => !row.unlocked && row.unlockTime === null)
        );
        assert.equal(rows[0].description, "visible");
        assert.equal(rows[0].icongray, "gray2");
        assert.equal(rows[1].description, undefined);
        assert.equal(rows[1].icongray, "icon");
      }
    });
  }
}
