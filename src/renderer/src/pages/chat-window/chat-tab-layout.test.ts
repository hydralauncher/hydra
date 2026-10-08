import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getChatTabLayout } from "./chat-tab-layout.js";

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `friend-${index}`);

describe("getChatTabLayout", () => {
  it("caps a single tab at the maximum width", () => {
    assert.deepEqual(getChatTabLayout(ids(1), "friend-0", 464), {
      visibleIds: ["friend-0"],
      hiddenIds: [],
      activeWidth: 180,
      inactiveWidth: 180,
    });
  });

  it("splits the strip evenly while every tab fits its active minimum", () => {
    const layout = getChatTabLayout(ids(3), "friend-0", 464);

    assert.equal(layout.activeWidth, 154);
    assert.equal(layout.inactiveWidth, 154);
    assert.deepEqual(layout.hiddenIds, []);
  });

  it("keeps the active tab readable and shrinks the rest", () => {
    const layout = getChatTabLayout(ids(7), "friend-3", 464);

    assert.equal(layout.activeWidth, 136);
    assert.equal(layout.inactiveWidth, 54);
    assert.equal(layout.visibleIds.length, 7);
  });

  it("moves tabs past the visible capacity into the overflow menu", () => {
    const layout = getChatTabLayout(ids(12), "friend-7", 464);

    assert.deepEqual(layout.visibleIds, ids(8));
    assert.deepEqual(layout.hiddenIds, [
      "friend-8",
      "friend-9",
      "friend-10",
      "friend-11",
    ]);
    assert.equal(layout.activeWidth, 136);
    assert.equal(layout.inactiveWidth, 40);
  });

  it("swaps a hidden active tab into the last visible slot", () => {
    const layout = getChatTabLayout(ids(12), "friend-10", 464);

    assert.equal(layout.visibleIds.length, 8);
    assert.equal(layout.visibleIds[7], "friend-10");
    assert.ok(layout.hiddenIds.includes("friend-7"));
    assert.ok(!layout.hiddenIds.includes("friend-10"));
  });

  it("returns an empty layout when there are no tabs", () => {
    assert.deepEqual(getChatTabLayout([], null, 464).visibleIds, []);
  });
});
