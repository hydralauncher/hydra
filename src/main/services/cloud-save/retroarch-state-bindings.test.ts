import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game, SnapshotFile } from "@types";

import {
  reconcileRetroArchStateBindings,
  type RetroArchObservedState,
} from "./retroarch-state-binding-policy.js";

const game = { shop: "launchbox", objectId: "131" } as Game;
const rawPath = "<emulator>/retroarch-v2/snes";
const hash = (value: string) => value.repeat(64);
const id = (value: string) => value.repeat(64);
const remoteFile = (stateId: string, fileHash: string): SnapshotFile => ({
  variantId: id("f"),
  rawPath,
  relativePath: `states/${stateId}.state`,
  hash: fileHash,
  sizeBytes: 1,
  lastModifiedAt: "2026-09-30T00:00:00.000Z",
});
const observed = (slot: number, fileHash: string): RetroArchObservedState => ({
  path: `/tmp/retroarch-test/Mario.state${slot}`,
  slot: `.state${slot}`,
  hash: fileHash,
  romPath: "/tmp/retroarch-test/Mario.sfc",
});

describe("RetroArch stable state bindings", () => {
  it("unites five cloud states and three independent notebook states", () => {
    const cloud = ["a", "b", "c", "d", "e"].map((value) =>
      remoteFile(id(value), hash(value))
    );
    const notebook = ["1", "2", "3"].map((value, index) =>
      observed(index + 1, hash(value))
    );
    const result = reconcileRetroArchStateBindings(
      game,
      { version: 1, activeRomPath: null, states: [] },
      notebook,
      cloud
    );
    assert.equal(result.states.length, 3);
    assert.equal(
      new Set([
        ...cloud.map((file) => file.relativePath),
        ...result.states.map((state) => `states/${state.id}.state`),
      ]).size,
      8
    );
  });

  it("keeps an ID through repeated edits on the same notebook slot", () => {
    const initial = reconcileRetroArchStateBindings(
      game,
      { version: 1, activeRomPath: null, states: [] },
      [observed(4, hash("a"))]
    );
    const once = reconcileRetroArchStateBindings(game, initial, [
      observed(4, hash("b")),
    ]);
    const twice = reconcileRetroArchStateBindings(game, once, [
      observed(4, hash("c")),
    ]);
    assert.equal(once.states[0].id, initial.states[0].id);
    assert.equal(twice.states[0].id, initial.states[0].id);
    assert.equal(twice.states[0].hash, hash("c"));
  });

  it("adopts a cloud ID when existing local bytes match", () => {
    const cloud = remoteFile(id("a"), hash("1"));
    const result = reconcileRetroArchStateBindings(
      game,
      { version: 1, activeRomPath: null, states: [] },
      [observed(1, cloud.hash)],
      [cloud]
    );
    assert.equal(result.states[0].id, id("a"));
  });

  it("keeps the ID after a ROM rename and later edits", () => {
    const initial = reconcileRetroArchStateBindings(
      game,
      { version: 1, activeRomPath: null, states: [] },
      [observed(1, hash("a"))]
    );
    const renamed = reconcileRetroArchStateBindings(game, initial, [
      {
        ...observed(4, hash("a")),
        path: "/tmp/retroarch-test/Mario_EUROPE.state4",
        romPath: "/tmp/retroarch-test/Mario_EUROPE.sfc",
      },
    ]);
    const edited = reconcileRetroArchStateBindings(game, renamed, [
      {
        ...observed(4, hash("b")),
        path: "/tmp/retroarch-test/Mario_EUROPE.state4",
        romPath: "/tmp/retroarch-test/Mario_EUROPE.sfc",
      },
    ]);
    assert.equal(renamed.states[0].id, initial.states[0].id);
    assert.equal(edited.states[0].id, initial.states[0].id);
  });
});
