import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  CHAT_BADGE_SIZE,
  getChatBadgeLabel,
  renderChatBadge,
} from "./chat-badge-image.js";

describe("getChatBadgeLabel", () => {
  it("shows nothing without unread messages", () => {
    assert.equal(getChatBadgeLabel(0), null);
  });

  it("shows the exact count up to nine", () => {
    assert.equal(getChatBadgeLabel(1), "1");
    assert.equal(getChatBadgeLabel(9), "9");
  });

  it("caps larger counts so they fit the overlay", () => {
    assert.equal(getChatBadgeLabel(10), "9+");
    assert.equal(getChatBadgeLabel(250), "9+");
  });
});

describe("renderChatBadge", () => {
  it("renders a square PNG at the badge size", async () => {
    const metadata = await sharp(await renderChatBadge("9+")).metadata();

    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, CHAT_BADGE_SIZE);
    assert.equal(metadata.height, CHAT_BADGE_SIZE);
  });
});
