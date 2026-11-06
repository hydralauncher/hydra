import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTorBoxHosterUri } from "./torbox-hoster-hosts.js";

describe("isTorBoxHosterUri", () => {
  it("accepts direct-download hoster URLs", () => {
    assert.equal(isTorBoxHosterUri("https://gofile.io/d/abc123"), true);
    assert.equal(isTorBoxHosterUri("https://pixeldrain.com/u/xyz"), true);
    assert.equal(isTorBoxHosterUri("https://fuckingfast.net/file/1"), true);
  });

  it("rejects hosts without a TorBox route and magnet links", () => {
    assert.equal(isTorBoxHosterUri("https://filekeeper.net/file/1"), false);
    assert.equal(isTorBoxHosterUri("https://1fichier.com/?abc"), false);
    assert.equal(isTorBoxHosterUri("magnet:?xt=urn:btih:abc"), false);
  });
});
