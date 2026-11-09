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

it("finishes large libraries without repeating recent attempts", async () => {
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
  assert.equal(calls, games.length);
  queue.schedule(games);
  await tick();
  assert.equal(calls, games.length);
});

it("reaches game 129 without another library read or any change notification", async () => {
  let calls = 0;
  const queue = new EpicLibraryArtworkQueue(
    async () => {
      calls++;
      return false;
    },
    () => assert.fail("fresh artwork must not notify"),
    Date.now,
    async () => {}
  );
  queue.schedule(
    Array.from({ length: 129 }, (_, index) => game(String(index)))
  );
  await tick();
  assert.equal(calls, 129);
});

it("does not restart a running pass when reads continue beyond cooldown", async () => {
  let now = 0;
  const calls: string[] = [];
  const games = Array.from({ length: 129 }, (_, index) => game(String(index)));
  const queue = new EpicLibraryArtworkQueue(
    async (g) => {
      calls.push(g.id);
      queue.schedule(games);
      return false;
    },
    () => assert.fail("fresh artwork must not notify"),
    () => now,
    async (ms) => {
      now += ms;
    }
  );
  queue.schedule(games);
  await tick();
  assert.deepEqual(
    calls,
    games.map((g) => g.id)
  );
  assert.ok(now > EPIC_LIBRARY_ARTWORK_RETRY_MS);
});

it("includes games added during a running pass without duplicating active games", async () => {
  let release!: () => void;
  const calls: string[] = [];
  const queue = new EpicLibraryArtworkQueue(
    async (g) => {
      calls.push(g.id);
      if (g.id === "one") await new Promise<void>((r) => (release = r));
      return false;
    },
    () => {},
    Date.now,
    async () => {}
  );
  queue.schedule([game("one"), game("two")]);
  queue.schedule([game("new"), game("two"), game("one")]);
  release();
  await tick();
  assert.deepEqual(calls, ["one", "two", "new"]);
});

it("keeps cooldowns for games omitted by a partial read after a pass ends", async () => {
  let now = 0;
  const calls: string[] = [];
  const queue = new EpicLibraryArtworkQueue(
    async (g) => {
      calls.push(g.id);
      return false;
    },
    () => {},
    () => now,
    async () => {}
  );
  queue.schedule([game("visible"), game("hidden")]);
  await tick();
  queue.schedule([game("hidden")]);
  await tick();
  queue.schedule([game("visible"), game("hidden")]);
  await tick();
  assert.deepEqual(calls, ["visible", "hidden"]);
  now += EPIC_LIBRARY_ARTWORK_RETRY_MS;
  queue.schedule([game("visible"), game("hidden")]);
  await tick();
  assert.deepEqual(calls, ["visible", "hidden", "visible", "hidden"]);
});
