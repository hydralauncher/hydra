import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserFriend } from "@types";
import {
  getBackgroundImageSizes,
  getBannerWidth,
  sortFriendsByUnreadMessages,
} from "./friends-window-layout.js";

const friend = (id: string) => ({ id }) as UserFriend;

describe("friends window layout", () => {
  it("keeps the original banner width at the minimum window width", () => {
    assert.equal(getBannerWidth(420), 420);
    assert.equal(getBannerWidth(300), 420);
  });

  it("grows the banner width in steps as the window widens", () => {
    assert.equal(getBannerWidth(421), 540);
    assert.equal(getBannerWidth(540), 540);
    assert.equal(getBannerWidth(800), 900);
  });

  it("derives background sizes from the banner width", () => {
    assert.deepEqual(getBackgroundImageSizes(420), {
      profile: { width: 420, height: 180 },
      friend: { width: 480, height: 96 },
    });
    assert.deepEqual(getBackgroundImageSizes(900).friend, {
      width: 960,
      height: 96,
    });
  });
});

describe("friends unread sorting", () => {
  it("puts friends with unread messages first, latest message first", () => {
    const sorted = sortFriendsByUnreadMessages(
      [friend("a"), friend("b"), friend("c"), friend("d")],
      { b: 1, d: 3 },
      { b: "2026-10-20T10:00:00Z", d: "2026-10-21T09:00:00Z" }
    );

    assert.deepEqual(
      sorted.map(({ id }) => id),
      ["d", "b", "a", "c"]
    );
  });

  it("keeps the original order of friends without unread messages", () => {
    const sorted = sortFriendsByUnreadMessages(
      [friend("a"), friend("b"), friend("c")],
      {},
      {}
    );

    assert.deepEqual(
      sorted.map(({ id }) => id),
      ["a", "b", "c"]
    );
  });

  it("places unread friends without a known message time after dated ones", () => {
    const sorted = sortFriendsByUnreadMessages(
      [friend("a"), friend("b"), friend("c")],
      { a: 1, c: 2 },
      { c: "2026-10-21T09:00:00Z" }
    );

    assert.deepEqual(
      sorted.map(({ id }) => id),
      ["c", "a", "b"]
    );
  });
});
