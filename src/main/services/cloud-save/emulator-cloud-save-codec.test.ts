import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  decodeEmulatorSaveIdentity,
  emulatorCloudSaveRawPath,
  encodeEmulatorSaveIdentity,
  isEmulatorCloudSaveRawPath,
} from "./emulator-cloud-save-codec.ts";

describe("emulator Cloud Save codec", () => {
  it("round trips complete PS1 and PS2 save identities", () => {
    const fixtures = [
      ["ps1", "BASCUS-94163DRAKAN", ".mcs"],
      ["ps2", "BESLES-50009", ".psu"],
    ] as const;

    for (const [platform, identity, extension] of fixtures) {
      const relativePath = encodeEmulatorSaveIdentity(identity, platform);
      assert.ok(relativePath.endsWith(extension));
      assert.equal(
        decodeEmulatorSaveIdentity(relativePath, platform),
        identity
      );
      assert.equal(
        isEmulatorCloudSaveRawPath(emulatorCloudSaveRawPath(platform)),
        true
      );
    }
  });

  it("rejects other markers, extensions and malformed identities", () => {
    assert.equal(isEmulatorCloudSaveRawPath("<emulator><v1><ps3>"), false);
    assert.throws(() =>
      decodeEmulatorSaveIdentity("QkFTQ1VTLTk0MTYz.psu", "ps1")
    );
    assert.throws(() => decodeEmulatorSaveIdentity("=.mcs", "ps1"));
  });
});
