import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import {
  handleEpicDescriptionLinkClick,
  resolveEpicDescriptionLink,
} from "./epic-description-links.js";

describe("Epic description links", () => {
  it("resolves absolute and relative HTTP(S) links", () => {
    assert.equal(
      resolveEpicDescriptionLink("/discover/example"),
      "https://store.epicgames.com/discover/example"
    );
    assert.equal(
      resolveEpicDescriptionLink("https://example.com/game"),
      "https://example.com/game"
    );
    assert.equal(
      resolveEpicDescriptionLink("http://example.com/game"),
      "http://example.com/game"
    );
  });

  it("blocks unsafe, empty and malformed links", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "file:///tmp/file",
      "mailto:user@example.com",
      "hydralauncher://game",
      "#chapter",
      "",
      "http://[invalid",
    ]) {
      assert.equal(resolveEpicDescriptionLink(href), null, href);
    }
  });

  it("opens a linked image externally and prevents Hydra navigation", () => {
    const dom = new JSDOM(
      '<div id="description"><a href="/discover/example"><img alt="Game"></a></div>'
    );
    const container = dom.window.document.getElementById("description")!;
    const image = container.querySelector("img")!;
    const opened: string[] = [];

    container.addEventListener("click", (event) =>
      handleEpicDescriptionLinkClick(event, async (url) => {
        opened.push(url);
      })
    );

    const click = new dom.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    const dispatched = image.dispatchEvent(click);

    assert.equal(dispatched, false);
    assert.equal(click.defaultPrevented, true);
    assert.deepEqual(opened, ["https://store.epicgames.com/discover/example"]);
  });

  it("intercepts auxiliary clicks on links", () => {
    const dom = new JSDOM(
      '<div id="description"><a href="https://example.com/game">Game</a></div>'
    );
    const container = dom.window.document.getElementById("description")!;
    const opened: string[] = [];

    container.addEventListener("auxclick", (event) =>
      handleEpicDescriptionLinkClick(event, async (url) => {
        opened.push(url);
      })
    );

    const click = new dom.window.MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    container.querySelector("a")!.dispatchEvent(click);

    assert.equal(click.defaultPrevented, true);
    assert.deepEqual(opened, ["https://example.com/game"]);
  });

  it("blocks unsafe links without swallowing unrelated clicks", () => {
    const dom = new JSDOM(
      '<div id="description"><a href="javascript:alert(1)">Bad</a><span>Text</span></div>'
    );
    const container = dom.window.document.getElementById("description")!;
    const opened: string[] = [];

    container.addEventListener("click", (event) =>
      handleEpicDescriptionLinkClick(event, async (url) => {
        opened.push(url);
      })
    );

    const badClick = new dom.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    container.querySelector("a")!.dispatchEvent(badClick);
    assert.equal(badClick.defaultPrevented, true);

    const textClick = new dom.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    container.querySelector("span")!.dispatchEvent(textClick);
    assert.equal(textClick.defaultPrevented, false);
    assert.deepEqual(opened, []);
  });
});
