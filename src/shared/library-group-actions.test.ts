import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyLibraryGroupAction,
  getLibraryGroupCollectionAssignments,
} from "./library-group-actions.js";

test("group actions preserve and deduplicate actual store identities", async () => {
  const epic = { shop: "epic" as const, objectId: "namespace:executable" };
  const calls: string[] = [];
  await applyLibraryGroupAction([epic, epic], async (game) => {
    calls.push(`${game.shop}:${game.objectId}`);
  });
  assert.deepEqual(calls, ["epic:namespace:executable"]);
});

test("group actions await all members and report partial failures", async () => {
  const calls: string[] = [];
  await assert.rejects(
    applyLibraryGroupAction(
      [
        { shop: "steam" as const, objectId: "10" },
        { shop: "epic" as const, objectId: "namespace:executable" },
      ],
      async (game) => {
        await Promise.resolve();
        calls.push(game.shop);
        if (game.shop === "steam") throw new Error("request failed");
      }
    ),
    AggregateError
  );
  assert.deepEqual(calls, ["steam", "epic"]);
});

test("group collection changes preserve unrelated per-store memberships", () => {
  const steam = {
    shop: "steam" as const,
    objectId: "10",
    collectionIds: ["a"],
  };
  const epic = {
    shop: "epic" as const,
    objectId: "item",
    collectionIds: ["b"],
  };
  assert.deepEqual(
    getLibraryGroupCollectionAssignments([steam, epic], ["a", "b", "new"]).map(
      (entry) => entry.collectionIds
    ),
    [
      ["a", "new"],
      ["b", "new"],
    ]
  );
  assert.deepEqual(
    getLibraryGroupCollectionAssignments([steam, epic], ["b"]).map(
      (entry) => entry.collectionIds
    ),
    [[], ["b"]]
  );
  assert.deepEqual(steam.collectionIds, ["a"]);
});
