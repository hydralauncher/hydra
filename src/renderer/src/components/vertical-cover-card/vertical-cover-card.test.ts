import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getVerticalCoverCardImageSources } from "./vertical-cover-card-image-sources.js";

describe("getVerticalCoverCardImageSources", () => {
  it("preserves fallback order while trimming and deduplicating sources", () => {
    assert.deepEqual(
      getVerticalCoverCardImageSources([
        " https://example.com/cover.jpg ",
        "https://example.com/library.jpg",
        "https://example.com/cover.jpg",
        "",
        null,
        "https://example.com/icon.jpg",
      ]),
      [
        "https://example.com/cover.jpg",
        "https://example.com/library.jpg",
        "https://example.com/icon.jpg",
      ]
    );
  });
});
