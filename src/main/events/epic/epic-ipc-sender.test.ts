import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTrustedEpicSender } from "./epic-ipc-sender.js";

describe("Epic IPC sender", () => {
  const sources = [
    "http://localhost:5174/",
    "file:///app/out/renderer/index.html",
    "https://release-v4-1-4.launcher.example/",
  ];
  const sender = {
    id: 1,
    isMainFrame: true,
    url: "http://localhost:5174/#/settings",
  };

  it("accepts only the launcher main frame at a configured renderer URL", () => {
    assert.equal(isTrustedEpicSender(sender, 1, sources), true);
    assert.equal(
      isTrustedEpicSender(
        { ...sender, url: `${sources[1]}#/settings` },
        1,
        sources
      ),
      true
    );
    assert.equal(
      isTrustedEpicSender(
        { ...sender, url: `${sources[2]}#/settings` },
        1,
        sources
      ),
      true
    );
  });

  it("rejects Epic/provider windows, subframes and navigated main windows", () => {
    assert.equal(isTrustedEpicSender({ ...sender, id: 2 }, 1, sources), false);
    assert.equal(
      isTrustedEpicSender({ ...sender, isMainFrame: false }, 1, sources),
      false
    );
    assert.equal(
      isTrustedEpicSender(
        { ...sender, url: "https://www.epicgames.com/" },
        1,
        sources
      ),
      false
    );
    assert.equal(
      isTrustedEpicSender(
        { ...sender, url: "http://localhost:5174/other.html" },
        1,
        sources
      ),
      false
    );
    assert.equal(
      isTrustedEpicSender(
        { ...sender, url: "http://localhost:5174/?remote=1" },
        1,
        sources
      ),
      false
    );
    assert.equal(
      isTrustedEpicSender(
        { ...sender, url: "http://localhost:5174@attacker.test/" },
        1,
        sources
      ),
      false
    );
    assert.equal(isTrustedEpicSender(sender, null, sources), false);
  });

  it("accepts the same portable renderer file when Node and Chromium encode '~' differently", () => {
    const encoded =
      "file:///C:/Users/PLAYER%7E1/AppData/Local/Temp/Hydra/resources/app.asar/out/renderer/index.html";
    const literal = encoded.replace("%7E", "~");
    assert.equal(
      isTrustedEpicSender({ ...sender, url: `${literal}#/settings` }, 1, [
        encoded,
      ]),
      true
    );
    assert.equal(
      isTrustedEpicSender({ ...sender, url: `${encoded}#/settings` }, 1, [
        literal,
      ]),
      true
    );
    for (const url of [
      literal.replace("index.html", "other.html"),
      `${literal}?remote=1`,
      literal.replace("file:///", "file://attacker.test/"),
      literal.replace("renderer/index.html", "renderer%2Findex.html"),
    ])
      assert.equal(
        isTrustedEpicSender({ ...sender, url }, 1, [encoded]),
        false
      );
    assert.equal(
      isTrustedEpicSender({ ...sender, url: literal, isMainFrame: false }, 1, [
        encoded,
      ]),
      false
    );
    assert.equal(
      isTrustedEpicSender({ ...sender, url: literal, id: 2 }, 1, [encoded]),
      false
    );
  });
});
