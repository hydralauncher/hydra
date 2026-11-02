import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getAddFriendErrorKey,
  isUserNotFoundError,
  normalizeFriendCode,
} from "./add-friend-errors.js";

describe("add friend errors", () => {
  it("maps API error codes to friendly messages", () => {
    assert.equal(
      getAddFriendErrorKey(new Error("friendship/users-already-friends")),
      "already_friends"
    );
    assert.equal(
      getAddFriendErrorKey(new Error("friendship/has-pending-invitation")),
      "friend_request_pending"
    );
    assert.equal(
      getAddFriendErrorKey(new Error("user/not-found")),
      "friend_code_not_found"
    );
    assert.equal(getAddFriendErrorKey(new Error("network down")), null);
  });

  it("recognizes a missing user when opening a profile", () => {
    assert.equal(isUserNotFoundError(new Error("user/not-found")), true);
    assert.equal(
      isUserNotFoundError(new Error("Request failed with status code 404")),
      true
    );
    assert.equal(
      isUserNotFoundError(new Error("profile/profile-not-visibile")),
      false
    );
  });

  it("trims and limits friend codes to eight characters", () => {
    assert.equal(normalizeFriendCode("  abcd1234xyz "), "abcd1234");
  });
});
