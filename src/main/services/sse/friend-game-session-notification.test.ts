import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toFriendGameSessionNotification } from "./friend-game-session-notification.ts";
import type { FriendGameSession } from "./types.ts";

const session = (fields: Record<string, unknown> = {}) =>
  ({
    objectId: "1091500",
    shop: "steam",
    friendId: "friend01",
    ...fields,
  }) as FriendGameSession;

describe("toFriendGameSessionNotification", () => {
  it("maps every profile field the server sends", () => {
    assert.deepEqual(
      toFriendGameSessionNotification(
        session({
          displayName: "Alice",
          profileImageUrl: "https://cdn.example/alice.png",
          gameTitle: "Cyberpunk 2077",
        })
      ),
      {
        displayName: "Alice",
        profileImageUrl: "https://cdn.example/alice.png",
        gameTitle: "Cyberpunk 2077",
      }
    );
  });

  it("skips the notification without a usable display name", () => {
    for (const displayName of [undefined, null, "", "   ", 42, {}]) {
      assert.equal(
        toFriendGameSessionNotification(
          session({
            displayName,
            profileImageUrl: "https://cdn.example/alice.png",
            gameTitle: "Cyberpunk 2077",
          })
        ),
        null
      );
    }
  });

  it("skips the notification for payloads from older servers", () => {
    assert.equal(toFriendGameSessionNotification(session()), null);
  });

  it("falls back to no avatar and no game title when they are missing", () => {
    for (const value of [undefined, null, "", "  ", 7]) {
      assert.deepEqual(
        toFriendGameSessionNotification(
          session({
            displayName: "Alice",
            profileImageUrl: value,
            gameTitle: value,
          })
        ),
        { displayName: "Alice", profileImageUrl: null, gameTitle: null }
      );
    }
  });
});
