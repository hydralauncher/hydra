import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getChatTabLayout } from "./chat-tab-layout.js";

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `friend-${index}`);

describe("getChatTabLayout", () => {
  it("caps a single tab at the maximum width", () => {
    assert.deepEqual(getChatTabLayout(ids(1), "friend-0", 468), {
      visibleIds: ["friend-0"],
      hiddenIds: [],
      tabWidth: 200,
    });
  });

  it("splits the strip evenly, minus the gaps between tabs", () => {
    const layout = getChatTabLayout(ids(3), "friend-0", 468);

    assert.equal(layout.tabWidth, 153);
    assert.deepEqual(layout.hiddenIds, []);
  });

  it("keeps every width when another tab becomes active", () => {
    assert.deepEqual(
      getChatTabLayout(ids(3), "friend-0", 468),
      getChatTabLayout(ids(3), "friend-2", 468)
    );
  });

  it("shrinks all tabs together as more open", () => {
    const layout = getChatTabLayout(ids(6), "friend-3", 468);

    assert.equal(layout.tabWidth, 74);
    assert.equal(layout.visibleIds.length, 6);
  });

  it("grows the tabs with a wider window", () => {
    const layout = getChatTabLayout(ids(4), "friend-0", 800);

    assert.equal(layout.tabWidth, 197);
  });

  it("fits tabs down to the minimum width before overflowing", () => {
    const layout = getChatTabLayout(ids(10), "friend-0", 468);

    assert.equal(layout.tabWidth, 43);
    assert.deepEqual(layout.hiddenIds, []);
  });

  it("moves tabs past the visible capacity into the overflow menu", () => {
    const layout = getChatTabLayout(ids(12), "friend-3", 468);

    assert.deepEqual(layout.visibleIds, ids(9));
    assert.deepEqual(layout.hiddenIds, ids(12).slice(9));
    assert.equal(layout.tabWidth, 43);
  });

  it("swaps a hidden active tab into the last visible slot", () => {
    const layout = getChatTabLayout(ids(12), "friend-10", 468);

    assert.equal(layout.visibleIds.length, 9);
    assert.equal(layout.visibleIds[8], "friend-10");
    assert.ok(layout.hiddenIds.includes("friend-8"));
    assert.ok(!layout.hiddenIds.includes("friend-10"));
  });

  it("returns an empty layout when there are no tabs", () => {
    assert.deepEqual(getChatTabLayout([], null, 468).visibleIds, []);
  });
});
