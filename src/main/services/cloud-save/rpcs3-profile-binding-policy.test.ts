import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chooseRpcs3CloudProfileId,
  isCurrentRpcs3ProfileBinding,
  listRpcs3CloudProfileIds,
} from "./rpcs3-profile-binding-policy.js";

describe("RPCS3 profile binding policy", () => {
  const binding = {
    configRoot: "/rpcs3",
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
      isCurrentRpcs3ProfileBinding(
        binding,
        "/rpcs3",
        "/rpcs3/dev_hdd0/home",
        "00000002"
      ),
      true
    );
    assert.equal(
      isCurrentRpcs3ProfileBinding(
        binding,
        "/rpcs3",
        "/other/dev_hdd0/home",
        "00000002"
      ),
      false
    );
    assert.equal(
      isCurrentRpcs3ProfileBinding(
        binding,
        "/rpcs3",
        "/rpcs3/dev_hdd0/home",
        "00000003"
      ),
      false
    );
    assert.equal(
      isCurrentRpcs3ProfileBinding(
        binding,
        "/other",
        "/rpcs3/dev_hdd0/home",
        "00000002"
      ),
      false
    );
  });

  it("uses the active local profile for a first upload", () => {
    assert.equal(chooseRpcs3CloudProfileId([], null, "00000002"), "00000002");
    assert.equal(
      chooseRpcs3CloudProfileId([], binding, "00000002"),
      "00000001"
    );
  });

  it("maps a sole remote profile before scanning local saves", () => {
    assert.equal(
      chooseRpcs3CloudProfileId(["00000001"], null, "00000002"),
      "00000001"
    );
    assert.equal(
      chooseRpcs3CloudProfileId(["00000003"], binding, "00000002"),
      "00000003"
    );
  });

  it("requires a choice only when multiple remote profiles lack a valid binding", () => {
    assert.equal(
      chooseRpcs3CloudProfileId(["00000001", "00000003"], null, "00000002"),
      null
    );
    assert.equal(
      chooseRpcs3CloudProfileId(["00000001", "00000003"], binding, "00000002"),
      "00000001"
    );
    assert.equal(
      chooseRpcs3CloudProfileId(["00000003", "00000004"], binding, "00000002"),
      null
    );
  });
});
