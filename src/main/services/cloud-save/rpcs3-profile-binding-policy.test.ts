import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCreateInitialRpcs3ProfileBinding,
  isCurrentRpcs3ProfileBinding,
  listRpcs3CloudProfileIds,
  needsRpcs3ProfileBinding,
} from "./rpcs3-profile-binding-policy.js";

describe("RPCS3 profile binding policy", () => {
  const binding = {
    homeRoot: "/rpcs3/dev_hdd0/home",
    localProfileId: "00000002",
    cloudProfileId: "00000001",
  };

  it("collects valid cloud profile IDs without duplicates", () => {
    assert.deepEqual(
      listRpcs3CloudProfileIds([
        { rawPath: "<emulator>/rpcs3/BLUS30443/00000001" },
        { rawPath: "<emulator>/rpcs3/BLUS30443/00000001" },
        { rawPath: "<emulator>/retroarch/gba/1234ABCD" },
      ]),
      ["00000001"]
    );
  });

  it("invalidates a binding when the installation or active user changes", () => {
    assert.equal(
      isCurrentRpcs3ProfileBinding(binding, "/rpcs3/dev_hdd0/home", "00000002"),
      true
    );
    assert.equal(
      isCurrentRpcs3ProfileBinding(binding, "/other/dev_hdd0/home", "00000002"),
      false
    );
    assert.equal(
      isCurrentRpcs3ProfileBinding(binding, "/rpcs3/dev_hdd0/home", "00000003"),
      false
    );
  });

  it("requires pairing before using an existing remote profile", () => {
    assert.equal(needsRpcs3ProfileBinding([], null), false);
    assert.equal(needsRpcs3ProfileBinding(["00000001"], null), true);
    assert.equal(needsRpcs3ProfileBinding(["00000003"], binding), true);
    assert.equal(needsRpcs3ProfileBinding(["00000001"], binding), false);
  });

  it("creates the first cloud identity only from a real local save", () => {
    assert.equal(
      canCreateInitialRpcs3ProfileBinding([], [], "00000001"),
      false
    );
    assert.equal(
      canCreateInitialRpcs3ProfileBinding(
        [],
        [{ rawPath: "<emulator>/rpcs3/BLUS30443/00000001" }],
        "00000001"
      ),
      true
    );
    assert.equal(
      canCreateInitialRpcs3ProfileBinding(
        ["00000002"],
        [{ rawPath: "<emulator>/rpcs3/BLUS30443/00000001" }],
        "00000001"
      ),
      false
    );
  });
});
