import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  resolveLibraryIsDeleted,
  resolveLibrarySource,
} from "./resolve-library-source.ts";

describe("resolveLibrarySource", () => {
  it("never downgrades hydra to steam", () => {
    assert.equal(resolveLibrarySource("hydra", "steam"), "hydra");
    assert.equal(resolveLibrarySource("steam", "hydra"), "hydra");
    assert.equal(resolveLibrarySource("hydra", "hydra"), "hydra");
  });

  it("stamps steam when neither side is hydra", () => {
    assert.equal(resolveLibrarySource("steam", "steam"), "steam");
    assert.equal(resolveLibrarySource(undefined, "steam"), "steam");
    assert.equal(resolveLibrarySource("steam", undefined), "steam");
  });

  it("defaults to hydra when provenance is missing", () => {
    assert.equal(resolveLibrarySource(undefined, undefined), "hydra");
    assert.equal(resolveLibrarySource(null, null), "hydra");
  });
});

describe("resolveLibraryIsDeleted", () => {
  it("undeletes when the remote game is steam-sourced", () => {
    assert.equal(resolveLibraryIsDeleted(true, "steam"), false);
    assert.equal(resolveLibraryIsDeleted(false, "steam"), false);
  });

  it("keeps the local deleted flag for hydra or missing provenance", () => {
    assert.equal(resolveLibraryIsDeleted(true, "hydra"), true);
    assert.equal(resolveLibraryIsDeleted(false, "hydra"), false);
    assert.equal(resolveLibraryIsDeleted(true, undefined), true);
    assert.equal(resolveLibraryIsDeleted(true, null), true);
    assert.equal(resolveLibraryIsDeleted(false, undefined), false);
  });
});
