import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMessage } from "./chat-message-groups.js";
import {
  countFriendMessagesAfter,
  createPendingMessage,
  createReply,
  findFirstFriendMessageAfter,
  findGapAfter,
  getLatestSeq,
  hasGapBefore,
  mergeChatMessages,
  mergePendingMessages,
  removeUnsentMessage,
  setMessageAttachmentIds,
  setMessageFailed,
  setMessageStatus,
  setMessageUploadProgress,
  setMessageVisibility,
  settleSendingMessage,
  toChatMessage,
  toPendingChatMessage,
} from "./chat-state.js";

const FRIEND_ID = "friend01";
const MY_ID = "myself01";
const CREATED_AT = "2026-10-05T12:00:00.000Z";

const stored = (seq: number, senderId = FRIEND_ID): ChatMessage =>
  toChatMessage(
    {
      seq,
      senderId,
      body: `message ${seq}`,
      clientNonce: `nonce-${seq}`,
      createdAt: CREATED_AT,
    },
    FRIEND_ID
  );

describe("toChatMessage", () => {
  it("keys messages by nonce and derives the side from the sender", () => {
    assert.deepEqual(stored(3), {
      id: "nonce-3",
      clientNonce: "nonce-3",
      seq: 3,
      fromMe: false,
      text: "message 3",
      createdAt: CREATED_AT,
      status: "sent",
    });
    assert.equal(stored(4, MY_ID).fromMe, true);
  });

  it("keeps reactions and tells whose they are", () => {
    const message = toChatMessage(
      {
        seq: 6,
        senderId: FRIEND_ID,
        body: "gg",
        clientNonce: "nonce-6",
        createdAt: CREATED_AT,
        reactions: [
          { userId: FRIEND_ID, emoji: "😂", updatedAt: CREATED_AT },
          { userId: MY_ID, emoji: "💀", updatedAt: CREATED_AT },
        ],
      },
      FRIEND_ID
    );

    assert.deepEqual(message.reactions, [
      { emoji: "😂", fromMe: false, updatedAt: CREATED_AT },
      { emoji: "💀", fromMe: true, updatedAt: CREATED_AT },
    ]);
    assert.equal(stored(7).reactions, undefined);
  });

  it("keeps the replied-to message, from either side", () => {
    const reply = (senderId: string) =>
      toChatMessage(
        {
          seq: 5,
          senderId: FRIEND_ID,
          body: "sure",
          clientNonce: "nonce-5",
          createdAt: CREATED_AT,
          replyToSeq: 4,
          replyTo: { senderId, body: "lunch?" },
        },
        FRIEND_ID
      ).replyTo;

    assert.deepEqual(reply(MY_ID), {
      seq: 4,
      quoted: { fromMe: true, text: "lunch?" },
    });
    assert.equal(reply(FRIEND_ID)?.quoted?.fromMe, false);
  });

  it("marks replies to messages past retention as unavailable", () => {
    const message = toChatMessage(
      {
        seq: 5,
        senderId: FRIEND_ID,
        body: "sure",
        clientNonce: "nonce-5",
        createdAt: CREATED_AT,
        replyToSeq: 4,
        replyTo: null,
      },
      FRIEND_ID
    );

    assert.deepEqual(message.replyTo, { seq: 4 });
  });
});

describe("toChatMessage with removed messages", () => {
  it("marks messages and quotes moderation removed", () => {
    const message = toChatMessage(
      {
        seq: 8,
        senderId: MY_ID,
        body: "",
        hidden: true,
        clientNonce: "nonce-8",
        createdAt: CREATED_AT,
        replyToSeq: 7,
        replyTo: { senderId: FRIEND_ID, body: "", hidden: true },
      },
      FRIEND_ID
    );

    assert.equal(message.isHidden, true);
    assert.deepEqual(message.replyTo, {
      seq: 7,
      quoted: { fromMe: false, text: "", isHidden: true },
    });
    assert.equal("isHidden" in stored(3), false);
  });
});

describe("createReply", () => {
  it("quotes stored messages by seq", () => {
    assert.deepEqual(createReply(stored(3)), {
      seq: 3,
      quoted: { fromMe: false, text: "message 3" },
    });
  });

  it("refuses messages the server has not stored", () => {
    assert.equal(createReply(createPendingMessage("hi", "nonce-9")), null);
  });

  it("refuses removed messages", () => {
    assert.equal(createReply({ ...stored(3), isHidden: true }), null);
  });

  it("is carried by the optimistic copy of a reply", () => {
    const replyTo = createReply(stored(3));
    const pending = createPendingMessage("ok", "nonce-9", CREATED_AT, replyTo);

    assert.deepEqual(pending.replyTo, replyTo);
    assert.equal(
      "replyTo" in createPendingMessage("ok", "nonce-10", CREATED_AT),
      false
    );
  });
});

describe("mergeChatMessages", () => {
  it("orders stored messages by seq and drops duplicates", () => {
    const merged = mergeChatMessages(
      [stored(1), stored(3)],
      [stored(2), stored(3)]
    );

    assert.deepEqual(
      merged.map((message) => message.seq),
      [1, 2, 3]
    );
  });

  it("keeps known reactions when a message arrives without any", () => {
    const reacted: ChatMessage = {
      ...stored(1),
      reactions: [{ emoji: "🔥", fromMe: true, updatedAt: CREATED_AT }],
    };

    const [fromRealtime] = mergeChatMessages([reacted], [stored(1)]);
    const [fromHistory] = mergeChatMessages(
      [reacted],
      [{ ...stored(1), reactions: [] }]
    );

    assert.deepEqual(fromRealtime.reactions, reacted.reactions);
    // History without it means it was removed; the removal keeps its time.
    assert.deepEqual(fromHistory.reactions, [
      { emoji: null, fromMe: true, updatedAt: CREATED_AT },
    ]);
  });

  it("keeps a reaction newer than the one history reports", () => {
    const later = "2026-10-09T13:00:00.000Z";
    const reacted: ChatMessage = {
      ...stored(1),
      reactions: [{ emoji: "🔥", fromMe: false, updatedAt: later }],
    };

    const [merged] = mergeChatMessages(
      [reacted],
      [
        {
          ...stored(1),
          reactions: [{ emoji: "😂", fromMe: false, updatedAt: CREATED_AT }],
        },
      ]
    );

    assert.deepEqual(merged.reactions, reacted.reactions);
  });

  it("replaces the optimistic copy once the server stores it", () => {
    const pending = createPendingMessage("hi", "nonce-9", CREATED_AT);
    const confirmed = toChatMessage(
      {
        seq: 2,
        senderId: MY_ID,
        body: "hi",
        clientNonce: "nonce-9",
        createdAt: CREATED_AT,
      },
      FRIEND_ID
    );

    const merged = mergeChatMessages([stored(1), pending], [confirmed]);

    assert.deepEqual(
      merged.map(({ id, seq, status }) => ({ id, seq, status })),
      [
        { id: "nonce-1", seq: 1, status: "sent" },
        { id: "nonce-9", seq: 2, status: "sent" },
      ]
    );
  });

  it("keeps unsent messages after stored ones, in writing order", () => {
    const first = createPendingMessage("first", "a", CREATED_AT);
    const second = createPendingMessage("second", "b", CREATED_AT);

    const merged = mergeChatMessages([first, second], [stored(1)]);

    assert.deepEqual(
      merged.map((message) => message.id),
      ["nonce-1", "a", "b"]
    );
  });
});

describe("setMessageStatus", () => {
  it("only changes unsent messages", () => {
    const pending = createPendingMessage("hi", "nonce-9", CREATED_AT);
    const messages = setMessageStatus(
      [stored(1), pending],
      "nonce-9",
      "failed"
    );

    assert.equal(messages[1].status, "failed");
    assert.equal(
      setMessageStatus(messages, "nonce-1", "failed")[0].status,
      "sent"
    );
  });
});

describe("setMessageFailed", () => {
  it("keeps why it failed until the next failure", () => {
    const pending = createPendingMessage("", "nonce-9", CREATED_AT);
    const capped = setMessageFailed([pending], "nonce-9", "daily_limit");

    assert.equal(capped[0].status, "failed");
    assert.equal(capped[0].failure, "daily_limit");
    assert.equal(setMessageFailed(capped, "nonce-9")[0].failure, undefined);
  });
});

describe("setMessageVisibility", () => {
  const reply = (seq: number, replyToSeq: number): ChatMessage =>
    toChatMessage(
      {
        seq,
        senderId: MY_ID,
        body: "lol",
        clientNonce: `nonce-${seq}`,
        createdAt: CREATED_AT,
        replyToSeq,
        replyTo: { senderId: FRIEND_ID, body: `message ${replyToSeq}` },
      },
      FRIEND_ID
    );

  it("removes the message and its quotes", () => {
    const messages = setMessageVisibility(
      [stored(1), stored(2), reply(3, 2)],
      2,
      null
    );

    assert.equal(messages[0].isHidden, undefined);
    assert.equal(messages[1].isHidden, true);
    assert.equal(messages[1].text, "");
    assert.deepEqual(messages[2].replyTo?.quoted, {
      fromMe: false,
      text: "",
      isHidden: true,
    });
    assert.equal(messages[2].text, "lol");
  });

  it("puts the message and its quotes back with their text", () => {
    const removed = setMessageVisibility([stored(2), reply(3, 2)], 2, null);
    const messages = setMessageVisibility(removed, 2, "message 2");

    assert.deepEqual(messages, [stored(2), reply(3, 2)]);
  });

  it("leaves other messages as they are", () => {
    const messages = [stored(1), reply(3, 1)];

    assert.equal(setMessageVisibility(messages, 2, null)[0], messages[0]);
    assert.equal(setMessageVisibility(messages, 2, null)[1], messages[1]);
  });
});

describe("gap detection", () => {
  it("finds the latest stored seq", () => {
    assert.equal(getLatestSeq([]), 0);
    assert.equal(
      getLatestSeq([stored(2), createPendingMessage("x", "x"), stored(5)]),
      5
    );
  });

  it("reports missing messages before an incoming seq", () => {
    assert.equal(hasGapBefore([stored(1), stored(2)], 3), false);
    assert.equal(hasGapBefore([stored(1), stored(2)], 5), true);
    assert.equal(hasGapBefore([], 5), false);
  });

  it("keeps the first recorded gap until it is loaded", () => {
    const messages = [stored(1), stored(2), stored(3)];

    assert.equal(findGapAfter({ messages, gapAfterSeq: null }, 4), null);
    assert.equal(findGapAfter({ messages, gapAfterSeq: null }, 6), 3);
    // Message 6 is loaded by now, but 4 and 5 are still missing.
    assert.equal(
      findGapAfter({ messages: [...messages, stored(6)], gapAfterSeq: 3 }, 7),
      3
    );
  });
});

describe("countFriendMessagesAfter", () => {
  it("counts only the friend's messages after the given one", () => {
    const messages = [stored(1), stored(2, MY_ID), stored(3), stored(4)];

    assert.equal(countFriendMessagesAfter(messages, messages[0].id), 2);
  });

  it("is zero when nothing came after it", () => {
    const messages = [stored(1), stored(2)];

    assert.equal(countFriendMessagesAfter(messages, messages[1].id), 0);
  });

  it("is zero when the message is no longer in the list", () => {
    assert.equal(countFriendMessagesAfter([stored(1)], "nonce-missing"), 0);
  });
});

describe("findFirstFriendMessageAfter", () => {
  it("skips my own messages", () => {
    const messages = [stored(1), stored(2, MY_ID), stored(3)];

    assert.equal(
      findFirstFriendMessageAfter(messages, messages[0].id),
      messages[2]
    );
  });

  it("is null when the friend sent nothing after it", () => {
    const messages = [stored(1), stored(2, MY_ID)];

    assert.equal(findFirstFriendMessageAfter(messages, messages[0].id), null);
  });
});

const IMAGE = {
  id: "attachment-1",
  contentType: "image/jpeg" as const,
  width: 1568,
  height: 882,
  spoiler: false,
  url: "https://images.example/attachment-1",
};

describe("messages with images", () => {
  it("keeps the images of stored messages, and reply image counts", () => {
    const message = toChatMessage(
      {
        seq: 9,
        senderId: FRIEND_ID,
        body: "",
        clientNonce: "nonce-9",
        createdAt: CREATED_AT,
        replyToSeq: 8,
        replyTo: { senderId: MY_ID, body: "", attachmentCount: 2 },
        attachments: [IMAGE],
      },
      FRIEND_ID
    );

    assert.deepEqual(message.attachments, [IMAGE]);
    assert.deepEqual(message.replyTo, {
      seq: 8,
      quoted: { fromMe: true, text: "", attachmentCount: 2 },
    });
    assert.equal(stored(10).attachments, undefined);
  });

  it("quotes how many images a replied-to message has", () => {
    const target = { ...stored(11), attachments: [IMAGE, IMAGE] };

    assert.equal(createReply(target)?.quoted?.attachmentCount, 2);
  });

  it("restores the user's held messages from the server", () => {
    const message = toPendingChatMessage({
      clientNonce: "nonce-held",
      status: "blocked",
      body: "look",
      replyToSeq: 4,
      createdAt: CREATED_AT,
      attachments: [IMAGE],
    });

    assert.deepEqual(message, {
      id: "nonce-held",
      clientNonce: "nonce-held",
      fromMe: true,
      text: "look",
      createdAt: CREATED_AT,
      status: "blocked",
      replyTo: { seq: 4 },
      attachments: [IMAGE],
      fromHistory: true,
    });
  });

  it("starts a message with images at no progress", () => {
    const local = { ...IMAGE, id: "local-1", url: null, localUrl: "blob:1" };
    const message = createPendingMessage("", "nonce-new", CREATED_AT, null, [
      local,
    ]);

    assert.equal(message.status, "pending");
    assert.equal(message.uploadProgress, 0);
    assert.deepEqual(message.attachments, [local]);
  });

  it("keeps the sender's local copies once the message is stored", () => {
    const local = { ...IMAGE, id: "local-1", url: null, localUrl: "blob:1" };
    const pending = createPendingMessage("", "nonce-9", CREATED_AT, null, [
      local,
    ]);
    const delivered = toChatMessage(
      {
        seq: 9,
        senderId: MY_ID,
        body: "",
        clientNonce: "nonce-9",
        createdAt: CREATED_AT,
        attachments: [IMAGE],
      },
      FRIEND_ID
    );

    const [merged] = mergeChatMessages([pending], [delivered]);

    assert.equal(merged.status, "sent");
    assert.deepEqual(merged.attachments, [{ ...IMAGE, localUrl: "blob:1" }]);
  });

  it("swaps local attachment ids for the reserved ones", () => {
    const local = { ...IMAGE, id: "local-1", url: null, localUrl: "blob:1" };
    const messages = setMessageAttachmentIds(
      [createPendingMessage("", "nonce-9", CREATED_AT, null, [local])],
      "nonce-9",
      ["server-1"]
    );

    assert.equal(messages[0].attachments?.[0].id, "server-1");
    assert.equal(messages[0].attachments?.[0].localUrl, "blob:1");
  });

  it("tracks upload progress on unsent messages only", () => {
    const messages = setMessageUploadProgress(
      [createPendingMessage("hi", "nonce-x", CREATED_AT), stored(1)],
      "nonce-x",
      0.5
    );

    assert.equal(messages[0].uploadProgress, 0.5);
    assert.equal(messages[1].uploadProgress, undefined);
  });

  it("settles a sending message unless an event got there first", () => {
    const sending = {
      ...createPendingMessage("", "nonce-a", CREATED_AT),
      uploadProgress: 1,
    };
    const blocked = {
      ...sending,
      clientNonce: "nonce-b",
      status: "blocked" as const,
    };

    const [checking, untouched] = settleSendingMessage(
      settleSendingMessage([sending, blocked], "nonce-a", "checking"),
      "nonce-b",
      "checking"
    );

    assert.equal(checking.status, "checking");
    assert.equal("uploadProgress" in checking, false);
    assert.equal(untouched.status, "blocked");
  });

  it("drops only unsent copies", () => {
    const unsent = setMessageStatus(
      [createPendingMessage("hi", "nonce-x", CREATED_AT)],
      "nonce-x",
      "failed"
    );

    assert.deepEqual(removeUnsentMessage([...unsent, stored(1)], "nonce-x"), [
      stored(1),
    ]);
    assert.deepEqual(removeUnsentMessage([stored(1)], "nonce-1"), [stored(1)]);
  });

  it("hides the image URLs of a removed message but keeps their size", () => {
    const message = {
      ...stored(9),
      attachments: [{ ...IMAGE, localUrl: "blob:1" }],
    };

    const [removed] = setMessageVisibility([message], 9, null);

    assert.equal(removed.isHidden, true);
    assert.deepEqual(removed.attachments, [
      { ...IMAGE, url: null, localUrl: undefined },
    ]);
  });
});

describe("mergePendingMessages", () => {
  const held = (clientNonce: string, status: "checking" | "blocked") =>
    toPendingChatMessage({
      clientNonce,
      status,
      body: "",
      replyToSeq: null,
      createdAt: CREATED_AT,
      attachments: [IMAGE],
    });

  it("adds held messages the window didn't know about", () => {
    const merged = mergePendingMessages(
      [stored(1)],
      [held("nonce-h", "checking")]
    );

    assert.deepEqual(
      merged.map((message) => message.clientNonce),
      ["nonce-1", "nonce-h"]
    );
  });

  it("applies the server's status to messages already settled locally", () => {
    const local = setMessageStatus(
      [createPendingMessage("", "nonce-h", CREATED_AT)],
      "nonce-h",
      "checking"
    );

    const [merged] = mergePendingMessages(local, [held("nonce-h", "blocked")]);

    assert.equal(merged.status, "blocked");
  });

  it("leaves messages still uploading or posting alone", () => {
    const local = [createPendingMessage("", "nonce-h", CREATED_AT)];

    const [merged] = mergePendingMessages(local, [held("nonce-h", "blocked")]);

    assert.equal(merged.status, "pending");
  });

  it("never brings back a message that was delivered meanwhile", () => {
    const delivered = {
      ...stored(5, MY_ID),
      clientNonce: "nonce-h",
      id: "nonce-h",
    };

    const merged = mergePendingMessages(
      [delivered],
      [held("nonce-h", "checking")]
    );

    assert.deepEqual(merged, [delivered]);
  });
});
