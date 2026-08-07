import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SUPPORTED_CLASSICS_PLATFORMS,
  resolveClassicsPlatformsForRequest,
  sanitizeClassicsPlatforms,
} from "./classics-platforms.js";

describe("sanitizeClassicsPlatforms", () => {
  it("keeps the supported platforms", () => {
    assert.deepEqual(sanitizeClassicsPlatforms(["ps2", "ps1"]), ["ps2", "ps1"]);
  });

  it("drops platforms this client cannot run", () => {
    assert.deepEqual(sanitizeClassicsPlatforms(["ps1", "nes", "gba"]), ["ps1"]);
  });

  it("returns an empty list for missing values", () => {
    assert.deepEqual(sanitizeClassicsPlatforms(undefined), []);
    assert.deepEqual(sanitizeClassicsPlatforms(null), []);
  });
});

describe("resolveClassicsPlatformsForRequest", () => {
  it("never asks for every platform when nothing is selected", () => {
    assert.deepEqual(
      resolveClassicsPlatformsForRequest([]),
      SUPPORTED_CLASSICS_PLATFORMS
    );
  });

  it("falls back to the allowlist when the selection is entirely unsupported", () => {
    assert.deepEqual(
      resolveClassicsPlatformsForRequest(["switch", "nes"]),
      SUPPORTED_CLASSICS_PLATFORMS
    );
  });

  it("keeps a supported subset", () => {
    assert.deepEqual(resolveClassicsPlatformsForRequest(["ps3", "gbc"]), [
      "ps3",
    ]);
  });

  it("does not hand out the shared allowlist array", () => {
    const resolved = resolveClassicsPlatformsForRequest([]);
    resolved.push("nes");

    assert.deepEqual(SUPPORTED_CLASSICS_PLATFORMS, ["ps1", "ps2", "ps3"]);
  });
});
