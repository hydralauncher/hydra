import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDolphinInstallOption,
  pickLatestDolphinReleaseTag,
} from "./dolphin-install-source.ts";

describe("Dolphin install sources", () => {
  it("selects a hotfix tag over its base release", () => {
    assert.equal(
      pickLatestDolphinReleaseTag(["nJoy", "2606", "2606a", "2603a", "5.0"]),
      "2606a"
    );
  });

  it("builds the official universal macOS package", () => {
    assert.deepEqual(buildDolphinInstallOption("2606a", "darwin", "arm64"), {
      id: "dolphin-install",
      binary: "dolphin",
      kind: "macos-dmg",
      channel: "release",
      downloadUrl:
        "https://dl.dolphin-emu.org/releases/2606a/dolphin-2606a-universal.dmg",
      fileName: "dolphin-2606a-universal.dmg",
      version: "2606a",
      htmlUrl: "https://dolphin-emu.org/download/release/2606a/",
      linkUrl: null,
      linkKind: null,
    });
  });

  it("uses the official Windows ARM64 package name", () => {
    const option = buildDolphinInstallOption("2606a", "win32", "arm64");

    assert.equal(option?.kind, "portable-archive");
    assert.equal(option?.fileName, "dolphin-2606a-arm64.7z");
  });
});
