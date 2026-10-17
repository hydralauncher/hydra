import assert from "node:assert/strict";
import { it } from "node:test";

import type { EmulatorConfig } from "@types";
import { clearRpcs3RootOnExecutableChange } from "./rpcs3-config-binding.js";

const config: EmulatorConfig = {
  system: "ps3",
  binary: "rpcs3",
  executablePath: "/first/rpcs3",
  rpcs3ConfigRoot: "/first/config",
  detectedVersion: null,
  detectedAt: null,
  biosPath: null,
  romFolders: [],
  lastScanAt: null,
  totalFiles: 0,
  totalSizeBytes: 0,
};

it("clears RPCS3 folder binding when executable changes or is removed", () => {
  assert.equal(
    clearRpcs3RootOnExecutableChange(config, {
      ...config,
      executablePath: "/second/rpcs3",
    }).rpcs3ConfigRoot,
    null
  );
  assert.equal(
    clearRpcs3RootOnExecutableChange(config, {
      ...config,
      executablePath: null,
    }).rpcs3ConfigRoot,
    null
  );
  assert.equal(
    clearRpcs3RootOnExecutableChange(config, {
      ...config,
      detectedVersion: "1.2",
    }).rpcs3ConfigRoot,
    "/first/config"
  );
});

it("keeps other emulator configuration independent", () => {
  const other: EmulatorConfig = { ...config, system: "ps2", binary: "pcsx2" };
  assert.equal(
    clearRpcs3RootOnExecutableChange(other, {
      ...other,
      executablePath: "/second/pcsx2",
    }).rpcs3ConfigRoot,
    "/first/config"
  );
});
