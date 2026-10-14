import assert from "node:assert/strict";
import { test } from "node:test";
import { EpicAchievementSource } from "./achievement-source.js";
import {
  parseEpicPlayerAchievements,
  parseEpicAchievementTargets,
} from "./achievement-protocol.js";
import type { EpicSnapshotGame } from "../../../types/epic-integration.types";
import { EPIC_SNAPSHOT_CHUNK_GAMES } from "./constants.js";

const context = {
  auth: { userId: "HydraA", environment: "https://api.test", generation: 1 },
  connection: {
    connected: true as const,
    connectionId: "AbCdEfG1",
    epicAccountId: "a".repeat(32),
    displayName: "Epic",
    connectedAt: "2026-10-14T00:00:00Z",
  },
};
const unlock = {
  epicAccountId: context.connection.epicAccountId,
  sandboxId: "primary",
  achievementSetId: "base",
  achievementName: "FIRST",
  unlocked: true,
  unlockDate: "2026-10-13T12:30:00.000Z",
};
const payload = (rows: unknown[] = [unlock], total = 1) => ({
  data: {
    PlayerAchievement: {
      playerAchievementGameRecordsBySandbox: {
        records: [
          {
            totalUnlocked: total,
            playerAchievements: rows.map((playerAchievement) => ({
              playerAchievement,
            })),
          },
        ],
      },
    },
  },
});
const game = (id = "item"): EpicSnapshotGame => ({
  namespace: "exec",
  catalogItemId: id,
  artifactIds: [id],
  name: "Game",
  playTimeInSeconds: 0,
});
const session = { token: async () => "private-test-token" };

test("queries achievements before resolving later batches and reuses shared sandboxes", async () => {
  let queries = 0;
  let batches = 0;
  const source = new EpicAchievementSource(session, async () => {
    queries++;
    return Response.json(payload());
  });
  const games = Array.from({ length: EPIC_SNAPSHOT_CHUNK_GAMES + 1 }, (_, id) =>
    game(String(id))
  );
  const result = await source.collect(
    context,
    games,
    new AbortController().signal,
    async (ids) => {
      if (++batches > 1)
        assert.equal(
          queries,
          1,
          "the first batch must already have its achievements"
        );
      return ids.map((objectId) => ({
        objectId,
        status: "supported",
        achievementSandboxId: "primary",
      }));
    }
  );
  assert.equal(batches, 2);
  assert.equal(queries, 1);
  assert.ok(result.games.every((game) => game.achievements?.length === 1));
  assert.deepEqual(result.pendingObjectIds, []);
});

test("Epic unlocks use exact set/name pairs, original UTC dates and verified identity", () => {
  const result = parseEpicPlayerAchievements(
    payload([unlock, { ...unlock, achievementSetId: "dlc" }], 2),
    context.connection.epicAccountId,
    "primary"
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].externalId, "FIRST");
  assert.equal(result[0].unlockTime, unlock.unlockDate);
  assert.throws(() =>
    parseEpicPlayerAchievements(
      payload([{ ...unlock, epicAccountId: "b".repeat(32) }]),
      context.connection.epicAccountId,
      "primary"
    )
  );
  assert.throws(() =>
    parseEpicPlayerAchievements(
      payload([{ ...unlock, sandboxId: "exec" }]),
      context.connection.epicAccountId,
      "primary"
    )
  );
});
test("only complete confirmed zero produces [], malformed and partial data preserve previous state", () => {
  assert.deepEqual(
    parseEpicPlayerAchievements(
      payload([], 0),
      context.connection.epicAccountId,
      "primary"
    ),
    []
  );
  for (const value of [
    payload([], 1),
    payload([{ ...unlock, unlockDate: null }]),
    payload([unlock, unlock], 2),
    { data: null },
    { errors: [{ message: "private" }] },
  ])
    assert.throws(() =>
      parseEpicPlayerAchievements(
        value,
        context.connection.epicAccountId,
        "primary"
      )
    );
  assert.throws(() =>
    parseEpicAchievementTargets({ targets: [] }, ["exec:item"])
  );
});
test("collection queries primary sandbox even at zero playtime and deduplicates shared sandboxes", async () => {
  let calls = 0;
  const source = new EpicAchievementSource(session, async (_url, options) => {
    calls++;
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      "Bearer private-test-token"
    );
    assert.equal(
      JSON.parse(options?.body as string).variables.sandboxId,
      "primary"
    );
    return Response.json(payload());
  });
  const result = await source.collect(
    context,
    [game("a"), game("b")],
    new AbortController().signal,
    async (ids) =>
      ids.map((objectId) => ({
        objectId,
        status: "supported",
        achievementSandboxId: "primary",
      }))
  );
  assert.equal(calls, 1);
  assert.equal(result.games[0].achievements?.length, 1);
  assert.deepEqual(result.pendingObjectIds, []);
});
test("per-game error does not lose games/playtime and pending games run first next time", async () => {
  const queried: string[] = [];
  const source = new EpicAchievementSource(session, async (_url, options) => {
    const sandbox = JSON.parse(options?.body as string).variables.sandboxId;
    queried.push(sandbox);
    return Response.json(
      sandbox === "a"
        ? { errors: [{ extensions: { code: "FORBIDDEN" } }] }
        : payload([{ ...unlock, sandboxId: sandbox }])
    );
  });
  const result = await source.collect(
    context,
    [game("a"), game("b")],
    new AbortController().signal,
    async (ids) =>
      ids.map((objectId) => ({
        objectId,
        status: "supported",
        achievementSandboxId: objectId.split(":")[1],
      })),
    ["exec:b"]
  );
  assert.equal(queried[0], "b");
  assert.equal(
    result.games.find((row) => row.catalogItemId === "a")?.achievements,
    null
  );
  assert.equal(
    result.games.find((row) => row.catalogItemId === "b")?.achievements?.length,
    1
  );
  assert.deepEqual(result.pendingObjectIds, ["exec:a"]);
});
test("budget timeout returns pending facets while parent cancellation rejects the operation", async () => {
  const source = new EpicAchievementSource(
    session,
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true }
        )
      )
  );
  const targets = async (ids: string[]) =>
    ids.map((objectId) => ({
      objectId,
      status: "supported" as const,
      achievementSandboxId: "primary",
    }));
  const result = await source.collect(
    context,
    [game()],
    new AbortController().signal,
    targets,
    [],
    undefined,
    10
  );
  assert.equal(result.games[0].achievements, null);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    source.collect(context, [game()], controller.signal, targets)
  );
});
