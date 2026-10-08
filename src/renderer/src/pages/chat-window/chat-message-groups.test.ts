import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupChatMessages, type ChatMessage } from "./chat-message-groups.js";

const message = (
  id: string,
  fromMe: boolean,
  createdAt: string
): ChatMessage => ({
  id,
  clientNonce: id,
  fromMe,
  text: id,
  createdAt,
  status: "sent",
});

describe("groupChatMessages", () => {
  it("groups consecutive messages from the same sender", () => {
    const days = groupChatMessages([
      message("a", false, "2026-09-30T19:30:00"),
      message("b", false, "2026-09-30T19:31:00"),
      message("c", true, "2026-09-30T19:32:00"),
    ]);

    assert.equal(days.length, 1);
    assert.deepEqual(
      days[0].groups.map((group) => group.messages.map(({ id }) => id)),
      [["a", "b"], ["c"]]
    );
  });

  it("starts a new group after a long pause", () => {
    const days = groupChatMessages([
      message("a", true, "2026-09-30T19:30:00"),
      message("b", true, "2026-09-30T19:40:00"),
    ]);

    assert.equal(days[0].groups.length, 2);
  });

  it("splits messages by day", () => {
    const days = groupChatMessages([
      message("a", true, "2026-09-29T23:59:00"),
      message("b", true, "2026-09-30T00:01:00"),
    ]);

    assert.equal(days.length, 2);
    assert.equal(days[1].groups[0].key, "b");
  });
});
