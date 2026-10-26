import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserFriend } from "@types";
import {
  BACKGROUND_IMAGE_SIZES,
  sortFriendsByUnreadMessages,
} from "./friends-window-layout.js";

const friend = (id: string) => ({ id }) as UserFriend;

describe("friends window layout", () => {
  it("processes banners once at twice the default size and shape", () => {
    assert.deepEqual(BACKGROUND_IMAGE_SIZES, {
      profile: { width: 840, height: 360 },
      friend: { width: 960, height: 192 },
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
