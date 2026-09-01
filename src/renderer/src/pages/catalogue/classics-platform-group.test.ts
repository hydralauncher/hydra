import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getClassicsPlatformGroup } from "./classics-platform-group.js";

describe("getClassicsPlatformGroup", () => {
  it("groups Sony platforms", () => {
    assert.equal(getClassicsPlatformGroup("Sony Playstation"), "sony");
    assert.equal(getClassicsPlatformGroup("Sony PSP"), "sony");
  });

  it("groups Nintendo platforms regardless of name position", () => {
    assert.equal(
      getClassicsPlatformGroup("Super Nintendo Entertainment System"),
      "nintendo"
    );
    assert.equal(getClassicsPlatformGroup("Nintendo GameCube"), "nintendo");
  });

  it("keeps unrelated platforms in the fallback group", () => {
    assert.equal(getClassicsPlatformGroup("Sega Genesis"), "other");
  });
});
