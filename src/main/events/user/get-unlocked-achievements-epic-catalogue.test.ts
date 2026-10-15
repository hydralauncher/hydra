import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import ts from "typescript";
import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
} from "../../services/achievements/achievement-sync-coordinator.ts";

type Row = {
  name: string;
  unlocked: boolean;
  unlockTime: number | null;
  description?: string;
  icongray: string;
};

const steamDefinitions = [
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
];

const load = (options: {
  linked: boolean;
  remoteAvailable: boolean;
  unlocked?: Array<{ name: string; unlockTime: number }>;
  switchAccountDuring?: "game-read" | "steam-read";
}) => {
  const reads: string[] = [];
  const writes: string[] = [];
  const steamCached: boolean[] = [];
  let ownerCurrent = true;
  const stubs: Record<string, unknown> = {
    "../register-event": { registerEvent: () => undefined },
    "@main/level": {
      db: { get: async () => null },
      levelKeys: {
        userPreferences: "preferences",
        game: () => "epic:game",
      },
      gamesSublevel: {
        get: async () => {
          if (options.switchAccountDuring === "game-read") ownerCurrent = false;
          return {
            catalogueGame: options.linked
              ? { shop: "steam", objectId: "752590" }
              : undefined,
          };
        },
      },
    },
    "@main/services/hydra-api": {
      HydraApi: {
        getAuthContext: () =>
          options.switchAccountDuring ? { userId: "owner" } : null,
        isAuthContextCurrent: () => ownerCurrent,
        get: async () => {
          throw Error("optional union unavailable");
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
        get: () => undefined,
        set: () => assert.fail("must not copy catalogue cache"),
      },
    },
    "@main/services/achievements/achievement-souvenir-store": {
      AchievementSouvenirStore: {
        set: (shop: string) => writes.push(shop),
        invalidate: () => undefined,
      },
    },
    "@main/services/achievements/get-game-achievement-data": {
      getGameAchievementData: async (
        id: string,
        shop: string,
        cached: boolean
      ) => {
        reads.push(`${shop}:${id}`);
        if (shop === "steam") steamCached.push(cached);
        if (shop !== "steam") return [];
        if (options.switchAccountDuring === "steam-read") ownerCurrent = false;
        return steamDefinitions;
      },
    },
    "@main/services/achievements/get-achievement-souvenirs": {
      fetchRemoteUserGameAchievements: async () => {
        if (!options.remoteAvailable) throw Error("Epic disconnected");
        const unlocked = options.unlocked ?? [];
        return {
          unlocked,
          achievements: unlocked.map(({ name }) => ({
            name,
            displayName: name,
            icon: "remote",
          })),
          souvenirs: new Map(),
        };
      },
    },
    "@main/services/achievements/merge-unlocked-achievements": {
      mergeUnlockedAchievementLists: (remote: unknown[]) => remote,
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
    ) => Promise<Row[]>;
  };
  new Function("exports", "require", output)(exported, (name: string) => {
    assert.ok(name in stubs, name);
    return stubs[name];
  });
  return { exported, reads, writes, steamCached };
};

for (const linked of [false, true]) {
  for (const remoteAvailable of [false, true]) {
    it(`shows locked catalogue definitions for empty Epic copy (linked=${linked}, remote=${remoteAvailable})`, async () => {
      const { exported, reads, writes } = load({ linked, remoteAvailable });
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

it("keeps catalogue definitions after the Epic copy records an unlock", async () => {
  const { exported, steamCached } = load({
    linked: true,
    remoteAvailable: true,
    unlocked: [{ name: "first", unlockTime: 1_000 }],
  });
  const rows = await exported.getUnlockedAchievements("game", "epic", false);
  assert.deepEqual(steamCached, [true]);
  assert.deepEqual(
    rows.map((row) => [row.name, row.unlocked, row.unlockTime]),
    [
      ["FIRST", true, 1_000],
      ["SECOND", false, null],
    ]
  );
  assert.equal(rows[0].description, "secret");
});

for (const switchAccountDuring of ["game-read", "steam-read"] as const) {
  it(`rejects catalogue definitions when the account changes during the ${switchAccountDuring}`, async () => {
    const { exported } = load({
      linked: true,
      remoteAvailable: true,
      switchAccountDuring,
    });
    await assert.rejects(
      exported.getUnlockedAchievements("game", "epic", true),
      AchievementSyncCancelledError
    );
  });
}

it("keeps the remote Epic list when the copy has no Steam catalogue", async () => {
  const { exported, reads } = load({
    linked: false,
    remoteAvailable: true,
    unlocked: [{ name: "only", unlockTime: 2_000 }],
  });
  const rows = await exported.getUnlockedAchievements("game", "epic", true);
  assert.deepEqual(reads, ["epic:game"]);
  assert.deepEqual(
    rows.map((row) => [row.name, row.unlocked, row.unlockTime]),
    [["only", true, 2_000]]
  );
});
