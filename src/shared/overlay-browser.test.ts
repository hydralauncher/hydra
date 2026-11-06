import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAllowedOverlayBrowserUrl,
  normalizeOverlayBrowserUrl,
} from "./overlay-browser.js";

describe("isAllowedOverlayBrowserUrl", () => {
  it("allows http and https URLs", () => {
    assert.equal(isAllowedOverlayBrowserUrl("https://example.com/path"), true);
    assert.equal(isAllowedOverlayBrowserUrl("http://localhost:3000"), true);
  });

  it("rejects unsafe or non-web schemes", () => {
    assert.equal(isAllowedOverlayBrowserUrl("javascript:alert(1)"), false);
    assert.equal(isAllowedOverlayBrowserUrl("file:///etc/passwd"), false);
    assert.equal(isAllowedOverlayBrowserUrl("data:text/html,hello"), false);
    assert.equal(isAllowedOverlayBrowserUrl("not a url"), false);
  });
});

describe("normalizeOverlayBrowserUrl", () => {
  it("adds https when the scheme is missing", () => {
    assert.equal(
      normalizeOverlayBrowserUrl("example.com/path"),
      "https://example.com/path"
    );
  });

  it("keeps valid http and https URLs", () => {
    assert.equal(
      normalizeOverlayBrowserUrl("https://example.com"),
      "https://example.com"
    );
    assert.equal(
      normalizeOverlayBrowserUrl("http://localhost:3000"),
      "http://localhost:3000"
    );
  });

  it("rejects empty and unsafe input", () => {
    assert.equal(normalizeOverlayBrowserUrl(""), null);
    assert.equal(normalizeOverlayBrowserUrl("   "), null);
    assert.equal(normalizeOverlayBrowserUrl("javascript:alert(1)"), null);
    assert.equal(normalizeOverlayBrowserUrl("file:///etc/passwd"), null);
  });
});
