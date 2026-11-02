import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWebUrl, splitMessageLinks } from "./chat-links.js";

describe("splitMessageLinks", () => {
  it("keeps text without links as one part", () => {
    assert.deepEqual(splitMessageLinks("gg wp"), [
      { type: "text", text: "gg wp" },
    ]);
  });

  it("finds a link between text", () => {
    assert.deepEqual(
      splitMessageLinks(
        "the fix is on https://www.pcgamingwiki.com/wiki/X too"
      ),
      [
        { type: "text", text: "the fix is on " },
        {
          type: "link",
          text: "https://www.pcgamingwiki.com/wiki/X",
          url: "https://www.pcgamingwiki.com/wiki/X",
        },
        { type: "text", text: " too" },
      ]
    );
  });

  it("finds several links", () => {
    const links = splitMessageLinks(
      "http://a.example.com and https://b.example.com"
    ).filter((part) => part.type === "link");

    assert.equal(links.length, 2);
  });

  it("leaves sentence punctuation out of the link", () => {
    assert.deepEqual(splitMessageLinks("see https://example.com/page."), [
      { type: "text", text: "see " },
      {
        type: "link",
        text: "https://example.com/page",
        url: "https://example.com/page",
      },
      { type: "text", text: "." },
    ]);
  });

  it("leaves a wrapping bracket out of the link", () => {
    const [, link, after] = splitMessageLinks("(https://example.com/a)");

    assert.deepEqual(link, {
      type: "link",
      text: "https://example.com/a",
      url: "https://example.com/a",
    });
    assert.deepEqual(after, { type: "text", text: ")" });
  });

  it("keeps a bracket the link opened", () => {
    const [link] = splitMessageLinks(
      "https://en.wikipedia.org/wiki/Hydra_(genus)"
    );

    assert.equal(link.text, "https://en.wikipedia.org/wiki/Hydra_(genus)");
  });

  it("ignores other schemes", () => {
    assert.deepEqual(splitMessageLinks("javascript:alert(1) file:///C:/x"), [
      { type: "text", text: "javascript:alert(1) file:///C:/x" },
    ]);
  });

  it("ignores a scheme inside a word", () => {
    assert.deepEqual(splitMessageLinks("xhttps://example.com"), [
      { type: "text", text: "xhttps://example.com" },
    ]);
  });

  it("ignores a link without a host", () => {
    assert.deepEqual(splitMessageLinks("https://."), [
      { type: "text", text: "https://." },
    ]);
  });
});

describe("parseWebUrl", () => {
  it("accepts http and https", () => {
    assert.equal(parseWebUrl("http://example.com")?.hostname, "example.com");
    assert.equal(parseWebUrl("https://example.com")?.hostname, "example.com");
  });

  it("rejects other schemes and garbage", () => {
    assert.equal(parseWebUrl("steam://install/1"), null);
    assert.equal(parseWebUrl("not a url"), null);
  });
});
