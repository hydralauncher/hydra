import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emulatorDefaultVariant,
  emulatorEnvironmentId,
  parseRpcs3GamedataRawPath,
  parseRpcs3SaveRawPath,
  parseRpcs3SavestateRawPath,
  rpcs3GamedataRawPath,
  parseRetroArchSaveRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";

describe("emulator save identities", () => {
  it("matches the native default-variant digest", () => {
    assert.equal(
      emulatorDefaultVariant("steam", "1817070").variantId,
      "6bb5b19456b48c65d5b6120154934d146013679fd8673e7d42694fff131774db"
    );
  });

  it("rejects malformed provider paths and traversal", () => {
    assert.deepEqual(
      parseRpcs3SaveRawPath("<emulator>/rpcs3/BLUS30443/00000001"),
      {
        titleId: "BLUS30443",
        profileId: "00000001",
      }
    );
    assert.equal(parseRpcs3SaveRawPath("<emulator>/rpcs3/BLUS30443/../"), null);
    assert.deepEqual(
      parseRpcs3SavestateRawPath("<emulator>/rpcs3-state/BLUS30443"),
      { titleId: "BLUS30443" }
    );
    assert.equal(
      parseRpcs3SavestateRawPath("<emulator>/rpcs3-state/../BLUS30443"),
      null
    );
    assert.deepEqual(
      parseRetroArchSaveRawPath("<emulator>/retroarch/gba/1234ABCD"),
      {
        platform: "gba",
        romHash: "1234ABCD",
      }
    );
    assert.equal(
      parseRetroArchSaveRawPath("<emulator>/retroarch/ps3/1234ABCD"),
      null
    );
    assert.equal(safeRelativeSegments("slot/../../outside"), null);
  });

  it("round-trips RPCS3 game data paths without profile IDs", () => {
    const rawPath = rpcs3GamedataRawPath("BCUS98245");
    assert.equal(rawPath, "<emulator>/rpcs3-gamedata/BCUS98245");
    assert.deepEqual(parseRpcs3GamedataRawPath(rawPath), {
      titleId: "BCUS98245",
    });
    assert.equal(parseRpcs3SaveRawPath(rawPath), null);
    assert.equal(parseRpcs3SavestateRawPath(rawPath), null);
    assert.equal(
      parseRpcs3GamedataRawPath("<emulator>/rpcs3-gamedata/../BCUS98245"),
      null
    );
    assert.equal(
      parseRpcs3GamedataRawPath("<emulator>/rpcs3-gamedata/BCUS98245/00000001"),
      null
    );
    assert.equal(
      parseRpcs3GamedataRawPath("<emulator>/rpcs3-gamedata/bcus98245"),
      null
    );
  });

  it("changes environment identity when the save root changes", () => {
    const before = emulatorEnvironmentId("base", "/saves/old");
    const after = emulatorEnvironmentId("base", "/saves/new");
    assert.notEqual(before, after);
    assert.equal(before, emulatorEnvironmentId("base", "/saves/old"));
  });
});
