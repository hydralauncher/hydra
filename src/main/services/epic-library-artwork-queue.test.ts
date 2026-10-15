import assert from "node:assert/strict";
import { it } from "node:test";
import type { LibraryGame } from "@types";
import {
  EpicLibraryArtworkQueue,
  EPIC_LIBRARY_ARTWORK_RETRY_MS,
  EPIC_LIBRARY_ARTWORK_INTERVAL_MS,
} from "./epic-library-artwork-queue.js";

const game = (id: string, shop = "epic") =>
  ({ id, shop, objectId: id }) as LibraryGame;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

it("hydrates Epic artwork serially, deduplicates reads and notifies changes", async () => {
  const calls: string[] = [];
  let release!: () => void;
  let changes = 0;
  const delays: number[] = [];
  const queue = new EpicLibraryArtworkQueue(
    async (g) => {
      calls.push(g.id);
      if (g.id === "one") await new Promise<void>((r) => (release = r));
      return true;
    },
    () => {
      changes++;
    },
    Date.now,
    async (ms) => {
      delays.push(ms);
    }
  );
  queue.schedule([game("one"), game("two")]);
  queue.schedule([
    game("one"),
    game("two"),
    game("steam", "steam"),
    {
      ...game("counterpart"),
      catalogueGame: { shop: "steam", objectId: "1" },
    },
  ]);
  assert.deepEqual(calls, ["one"]);
  release();
  await tick();
  assert.deepEqual(calls, ["one", "two"]);
  assert.equal(changes, 2);
  assert.deepEqual(delays, [EPIC_LIBRARY_ARTWORK_INTERVAL_MS]);
});

it("retries failures after cooldown without breaking the remaining library", async () => {
  let now = 0;
  const calls: string[] = [];
  let changes = 0;
  const queue = new EpicLibraryArtworkQueue(
    async (g) => {
      calls.push(g.id);
      if (g.id === "offline") throw Error("offline");
      return false;
    },
    () => {
      changes++;
    },
    () => now,
    async () => {}
  );
  queue.schedule([game("offline"), game("empty")]);
  await tick();
  queue.schedule([game("offline")]);
  await tick();
  assert.deepEqual(calls, ["offline", "empty"]);
  now += EPIC_LIBRARY_ARTWORK_RETRY_MS;
  queue.schedule([game("offline")]);
  await tick();
  assert.deepEqual(calls, ["offline", "empty", "offline"]);
  assert.equal(changes, 0);
});

it("bounds large libraries without repeatedly evicting recent attempts", async () => {
  let calls = 0;
  const queue = new EpicLibraryArtworkQueue(
    async () => {
      calls++;
      return true;
    },
    () => queue.schedule(games),
    Date.now,
    async () => {}
  );
  const games = Array.from({ length: 1000 }, (_, index) => game(String(index)));
  queue.schedule(games);
  await tick();
  assert.equal(calls, 512);
  queue.schedule(games);
  await tick();
  assert.equal(calls, 512);
});
