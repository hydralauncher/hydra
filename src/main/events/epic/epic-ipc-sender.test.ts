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
});
