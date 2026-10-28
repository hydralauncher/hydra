import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProfileFriends, UserFriend } from "@types";
import {
  fetchAllProfileFriends,
  PROFILE_FRIENDS_PAGE_SIZE,
} from "./profile-friends.js";

const createFriends = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => ({ id: `f${index}` }) as UserFriend
  );

const createPager = (friends: UserFriend[], onlineFriends = 0) => {
  const requests: Array<{ take: number; skip: number }> = [];
  const fetchPage = async (take: number, skip: number) => {
    requests.push({ take, skip });
    return {
      totalFriends: friends.length,
      onlineFriends,
      friends: friends.slice(skip, skip + take),
    } satisfies ProfileFriends;
  };

  return { requests, fetchPage };
};

describe("fetchAllProfileFriends", () => {
  it("loads every page beyond the API page size", async () => {
    const friends = createFriends(250);
    const pager = createPager(friends, 30);

    const result = await fetchAllProfileFriends(pager.fetchPage);

    assert.equal(result.friends.length, 250);
    assert.equal(result.totalFriends, 250);
    assert.equal(result.onlineFriends, 30);
    assert.deepEqual(
      pager.requests.map(({ skip }) => skip),
      [0, 100, 200]
    );
    assert.ok(
      pager.requests.every(({ take }) => take === PROFILE_FRIENDS_PAGE_SIZE)
    );
  });

  it("makes a single request when everything fits in one page", async () => {
    const pager = createPager(createFriends(40));

    const result = await fetchAllProfileFriends(pager.fetchPage);

    assert.equal(result.friends.length, 40);
    assert.equal(pager.requests.length, 1);
  });

  it("drops friends repeated across pages", async () => {
    const result = await fetchAllProfileFriends(async (_take, skip) => ({
      totalFriends: 150,
      onlineFriends: 0,
      friends:
        skip === 0
          ? createFriends(100)
          : [...createFriends(100).slice(99), { id: "extra" } as UserFriend],
    }));

    assert.equal(result.friends.length, 101);
  });
});
