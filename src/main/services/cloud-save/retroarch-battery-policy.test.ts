import assert from "node:assert/strict";
import { it } from "node:test";

import type { RetroArchLocalBatteryCandidate } from "@types";

import { dedupeRetroArchBatteryCandidates } from "./retroarch-battery-policy.js";

const candidate = (
  romPath: string,
  savePath: string
): RetroArchLocalBatteryCandidate => ({
  romPath,
  signature: "a".repeat(64),
  files: [
    {
      relativePath: "battery.srm",
      path: savePath,
      hash: "b".repeat(64),
      lastModifiedAt: "2026-09-30T00:00:00.000Z",
    },
  ],
});

it("scans one physical save once when two ROMs share a stem and save root", () => {
  const shared = "/retroarch/saves/Mario.srm";
  const candidates = dedupeRetroArchBatteryCandidates([
    candidate("/roms/usa/Mario.sfc", shared),
    candidate("/roms/europe/Mario.sfc", shared),
    candidate("/roms/translated/Mario.sfc", "/other/Mario.srm"),
  ]);
  assert.deepEqual(
    candidates.map((item) => item.romPath),
    ["/roms/usa/Mario.sfc", "/roms/translated/Mario.sfc"]
  );
});
