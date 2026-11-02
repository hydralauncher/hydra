import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const { window } = new JSDOM("");
Object.assign(globalThis, { DOMParser: window.DOMParser });

const { renderReadmeHtml, sanitizeReadmeHtml } = await import(
  "./readme-html.js"
);

const directory = "src/renderer/src/pages/game-details/recompilation/readmes";

const parse = (html: string) =>
  new window.DOMParser().parseFromString(html, "text/html").body;

for (const file of ["2ship2harkinian.md", "zelda64recomp.md"]) {
  test(`${file} renders with absolute https URLs only`, () => {
    const body = parse(
      renderReadmeHtml(fs.readFileSync(`${directory}/${file}`, "utf8"))
    );

    assert.ok(body.querySelector("h1"));

    const links = Array.from(body.querySelectorAll("a"));
    assert.ok(links.length > 0);
    for (const link of links) {
      assert.match(link.getAttribute("href") ?? "", /^https:\/\//);
      assert.equal(link.getAttribute("target"), "_blank");
      assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    }

    for (const image of Array.from(body.querySelectorAll("img"))) {
      assert.match(image.getAttribute("src") ?? "", /^https:\/\//);
    }

    assert.equal(body.querySelector("source"), null);
  });
}

test("2 Ship 2 Harkinian uses the dark libultraship logo", () => {
  const body = parse(
    renderReadmeHtml(fs.readFileSync(`${directory}/2ship2harkinian.md`, "utf8"))
  );

  assert.equal(
    body
      .querySelector('img[alt="Powered by libultraship"]')
      ?.getAttribute("src"),
    "https://raw.githubusercontent.com/2ship2harkinian/2ship2harkinian/develop/docs/poweredbylus.darkmode.png"
  );
});

test("unsafe markup is removed", () => {
  const body = parse(
    sanitizeReadmeHtml(
      '<p onclick="x()" style="color:red">hi<script>alert(1)</script></p>' +
        '<a href="javascript:alert(1)">bad</a><img src="data:image/png;base64,AA">' +
        '<iframe src="https://example.com"></iframe><custom-tag>kept text</custom-tag>'
    )
  );

  assert.equal(body.querySelector("script, iframe, custom-tag"), null);
  assert.equal(body.querySelector("p")?.attributes.length, 0);
  assert.equal(body.querySelector("a")?.hasAttribute("href"), false);
  assert.equal(body.querySelector("img")?.hasAttribute("src"), false);
  assert.match(body.textContent ?? "", /kept text/);
});
