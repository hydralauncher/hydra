import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserFriend, UserPreferences } from "@types";
import {
  getSocialWindowsRestorePlan,
  getSocialWindowsShowOrder,
  getTopSocialWindow,
  orderChatFriends,
} from "./social-windows-restore-plan.js";

const friend = (id: string) => ({ id, displayName: id }) as UserFriend;

describe("social windows restore plan", () => {
  it("reopens the windows that were open when Hydra quit", () => {
    const plan = getSocialWindowsRestorePlan(
      {
        friendsWindowOpen: true,
        chatFriends: [friend("aaaaaaaa"), friend("bbbbbbbb")],
        activeChatFriendId: "bbbbbbbb",
        topWindow: "chat",
      },
      null
    );

    assert.equal(plan.openFriendsWindow, true);
    assert.deepEqual(
      plan.chatFriends.map(({ id }) => id),
      ["aaaaaaaa", "bbbbbbbb"]
    );
    assert.equal(plan.activeChatFriendId, "bbbbbbbb");
    assert.deepEqual(plan.showOrder, ["friends", "chat"]);
  });

  it("opens the friends window on startup when the setting is on", () => {
    const plan = getSocialWindowsRestorePlan(null, {
      openFriendsWindowOnStartup: true,
    } as UserPreferences);

    assert.equal(plan.openFriendsWindow, true);
    assert.deepEqual(plan.showOrder, ["friends"]);
  });

  it("opens nothing without a saved session or the setting", () => {
    assert.deepEqual(getSocialWindowsRestorePlan(null, null), {
      openFriendsWindow: false,
      chatFriends: [],
      activeChatFriendId: null,
      showOrder: [],
    });
  });

  it("ignores a session saved in an older format", () => {
    const plan = getSocialWindowsRestorePlan(
      { chatFriendIds: ["aaaaaaaa"] } as never,
      null
    );

    assert.deepEqual(plan.chatFriends, []);
    assert.deepEqual(plan.showOrder, []);
  });
});

describe("social windows stacking", () => {
  it("shows the window that was on top last", () => {
    assert.deepEqual(getSocialWindowsShowOrder(true, true, "chat"), [
      "friends",
      "chat",
    ]);
    assert.deepEqual(getSocialWindowsShowOrder(true, true, "friends"), [
      "chat",
      "friends",
    ]);
  });

  it("uses the last focused window when both are open", () => {
    assert.equal(getTopSocialWindow(true, true, "friends"), "friends");
    assert.equal(getTopSocialWindow(true, true, null), "chat");
    assert.equal(getTopSocialWindow(true, false, "chat"), "friends");
    assert.equal(getTopSocialWindow(false, false, "chat"), null);
  });

  it("keeps chat tabs in their open order", () => {
    assert.deepEqual(
      orderChatFriends(
        ["bbbbbbbb", "aaaaaaaa", "cccccccc"],
        [friend("aaaaaaaa"), friend("bbbbbbbb")]
      ).map(({ id }) => id),
      ["bbbbbbbb", "aaaaaaaa"]
    );
  });
});
