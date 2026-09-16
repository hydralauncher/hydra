import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GameExecutableCatalogStore,
  normalizeGameExecutableCatalog,
} from "./game-executables-core.js";

const catalog = {
  "10": [
    { name: ">folder/game.exe", os: "win32" },
    { name: "folder/game", os: "linux" },
  ],
  "20": [{ name: "other/tool.exe", os: "win32" }],
};

describe("game executable catalogue", () => {
  it("normalizes Windows paths and keeps Windows executables", () => {
    assert.deepEqual(normalizeGameExecutableCatalog(catalog, "win32"), {
      "10": [{ name: "folder\\game.exe", exe: "game.exe" }],
      "20": [{ name: "other\\tool.exe", exe: "tool.exe" }],
    });
  });

  it("keeps native and compatibility executables on Linux", () => {
    assert.deepEqual(normalizeGameExecutableCatalog(catalog, "linux"), {
      "10": [
        { name: "folder/game.exe", exe: "game.exe" },
        { name: "folder/game", exe: "game" },
      ],
      "20": [{ name: "other/tool.exe", exe: "tool.exe" }],
    });
  });

  it("retries a failed load and caches the successful catalogue", async () => {
    const store = new GameExecutableCatalogStore("linux");
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return catalog;
    };

    assert.equal(await store.ensureLoaded(load, true), false);
    assert.equal(await store.ensureLoaded(load, true), true);
    assert.equal(await store.ensureLoaded(load, true), true);
    assert.equal(calls, 2);
  });

  it("serializes concurrent catalogue loads", async () => {
    const store = new GameExecutableCatalogStore("win32");
    let calls = 0;
    let resolveLoad!: (value: typeof catalog) => void;
    const load = () => {
      calls += 1;
      return new Promise<typeof catalog>((resolve) => {
        resolveLoad = resolve;
      });
    };

    const first = store.ensureLoaded(load);
    const second = store.ensureLoaded(load);
    resolveLoad(catalog);

    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.equal(calls, 1);
  });

  it("throttles background retries while allowing an explicit retry", async () => {
    let now = 1_000;
    const store = new GameExecutableCatalogStore("linux", 30_000, () => now);
    let calls = 0;
    const fail = async () => {
      calls += 1;
      throw new Error("offline");
    };

    assert.equal(await store.ensureLoaded(fail), false);
    now += 1_000;
    assert.equal(await store.ensureLoaded(fail), false);
    assert.equal(calls, 1);
    assert.equal(await store.ensureLoaded(async () => catalog, true), true);
  });
});
