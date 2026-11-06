import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const { window } = new JSDOM("");
Object.assign(globalThis, { DOMParser: window.DOMParser });

const { getReadmeBaseUrls, renderReadmeHtml } = await import(
  "./readme-html.js"
);

const parse = (html: string) =>
  new window.DOMParser().parseFromString(html, "text/html").body;

const base = getReadmeBaseUrls("Zelda64Recomp/Zelda64Recomp", "dev");

test("relative links and images resolve against the repository", () => {
  const body = parse(
    renderReadmeHtml(
      "[Building](BUILDING.md) ![Logo](icons/512.png) [Site](https://zelda64recomp.com)",
      base
    )
  );

  const [building, site] = Array.from(body.querySelectorAll("a"));
  assert.equal(
    building.getAttribute("href"),
    "https://github.com/Zelda64Recomp/Zelda64Recomp/blob/dev/BUILDING.md"
  );
  assert.equal(site.getAttribute("href"), "https://zelda64recomp.com/");
  assert.equal(building.getAttribute("target"), "_blank");
  assert.equal(
    body.querySelector("img")?.getAttribute("src"),
    "https://raw.githubusercontent.com/Zelda64Recomp/Zelda64Recomp/dev/icons/512.png"
  );
});

test("unsafe markup and in-page anchors are removed", () => {
  const body = parse(
    renderReadmeHtml(
      [
        '<script>alert(1)</script><img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">bad</a>',
        '<a href="http://example.com">plain http</a>',
        "[Jump](#features)",
        '<p style="color:red">text</p>',
      ].join("\n\n"),
      base
    )
  );

  assert.equal(body.querySelector("script"), null);
  assert.equal(body.querySelector("[onerror]"), null);
  assert.equal(body.querySelector("[style]"), null);
  for (const link of Array.from(body.querySelectorAll("a"))) {
    assert.equal(link.getAttribute("href"), null);
  }
});

test("GitHub alerts get their title and lose the marker", () => {
  const body = parse(
    renderReadmeHtml("> [!NOTE]\n> Saves are kept.\n\n> Just a quote.", base)
  );

  const [alert, quote] = Array.from(body.querySelectorAll("blockquote"));
  assert.equal(alert.className, "markdown-alert markdown-alert-note");
  assert.equal(
    alert.querySelector(".markdown-alert-title")?.textContent,
    "Note"
  );
  assert.ok(!alert.textContent?.includes("[!NOTE]"));
  assert.ok(alert.textContent?.includes("Saves are kept."));
  assert.equal(quote.className, "");
});

test("an alert marker with a hard break leaves no empty line", () => {
  const body = parse(
    renderReadmeHtml("> [!NOTE]  \r\n> **Intel GPU users:** update.", base)
  );

  const paragraph = body.querySelector(".markdown-alert > p:nth-child(2)");
  assert.equal(paragraph?.firstChild?.nodeName, "STRONG");
});
