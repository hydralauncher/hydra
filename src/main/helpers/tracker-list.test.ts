import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isValidTrackerListUrl,
  isValidTrackerUrl,
  parseTrackerList,
} from "../../shared/tracker-list.ts";

describe("isValidTrackerUrl", () => {
  it("accepts http, https, udp, ws and wss trackers", () => {
    assert.strictEqual(
      isValidTrackerUrl("https://tracker.example.com/announce"),
      true
    );
    assert.strictEqual(
      isValidTrackerUrl("http://tracker.example.com:8080/announce"),
      true
    );
    assert.strictEqual(
      isValidTrackerUrl("udp://tracker.example.com:6969/announce"),
      true
    );
    assert.strictEqual(
      isValidTrackerUrl("wss://tracker.example.com/announce"),
      true
    );
  });

  it("rejects invalid or unsupported protocols", () => {
    assert.strictEqual(isValidTrackerUrl("ftp://tracker.example.com"), false);
    assert.strictEqual(isValidTrackerUrl("not-a-url"), false);
    assert.strictEqual(isValidTrackerUrl(""), false);
  });
});

describe("isValidTrackerListUrl", () => {
  it("accepts http and https list URLs", () => {
    assert.strictEqual(
      isValidTrackerListUrl("https://example.com/trackers.txt"),
      true
    );
    assert.strictEqual(
      isValidTrackerListUrl("http://example.com/trackers.txt"),
      true
    );
  });

  it("rejects non-http list URLs", () => {
    assert.strictEqual(
      isValidTrackerListUrl("udp://tracker.example.com:6969/announce"),
      false
    );
    assert.strictEqual(
      isValidTrackerListUrl("ftp://example.com/trackers.txt"),
      false
    );
    assert.strictEqual(isValidTrackerListUrl("not-a-url"), false);
    assert.strictEqual(isValidTrackerListUrl(""), false);
  });
});

describe("parseTrackerList", () => {
  it("parses newline separated trackers", () => {
    const list = "udp://a.com/announce\nhttps://b.com/announce";
    assert.deepStrictEqual(parseTrackerList(list), [
      "udp://a.com/announce",
      "https://b.com/announce",
    ]);
  });

  it("ignores empty lines and comments", () => {
    const list =
      "\n  udp://a.com/announce  \n# comment\n\nhttps://b.com/announce\n";
    assert.deepStrictEqual(parseTrackerList(list), [
      "udp://a.com/announce",
      "https://b.com/announce",
    ]);
  });

  it("deduplicates entries", () => {
    const list = "udp://a.com/announce\nudp://a.com/announce";
    assert.deepStrictEqual(parseTrackerList(list), ["udp://a.com/announce"]);
  });
});
