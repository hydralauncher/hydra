import assert from "node:assert/strict";
import { it } from "node:test";

import type { Game, RestoreManifestFile } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { stateFilesRequiringConfirmation } from "./state-restore-policy.ts";

const game = {
  shop: "launchbox",
  platform: "Super Nintendo Entertainment System",
} as Game;
const file = (
  relativePath: string,
  stateMetadata?: RestoreManifestFile["stateMetadata"]
): RestoreManifestFile => ({
  variantId: "a".repeat(64),
  rawPath: "<emulator>/retroarch/snes/1234ABCD",
  relativePath,
  hash: "b".repeat(64),
  sizeBytes: 1,
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
  ...(stateMetadata ? { stateMetadata } : {}),
});

it("asks for unknown or different state versions but leaves ordinary saves alone", () => {
  const files = [
    file("battery.srm"),
    file("state.state", {
      emulatorId: "retroarch",
      coreId: "snes9x",
      version: "1",
    }),
    file("state.state1", {
      emulatorId: "retroarch",
      coreId: "snes9x",
      version: "2",
    }),
    file("state.state2"),
  ];
  assert.deepEqual(
    stateFilesRequiringConfirmation(game, files, {
      emulatorId: "retroarch",
      coreId: "snes9x",
      version: "1",
    }).map(({ relativePath }) => relativePath),
    ["state.state1", "state.state2"]
  );
});
