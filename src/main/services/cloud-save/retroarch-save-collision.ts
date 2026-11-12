import path from "node:path";

import { canonicalRestoreTargetKey } from "./restore-target-collision.js";
import { retroArchPhysicalSaveName } from "./retroarch-save-config.js";

export interface RetroArchSaveLayout {
  romPath: string;
  saveDirectory: string | null;
  stateDirectory: string | null;
}

const targetKeys = (layout: RetroArchSaveLayout) => {
  const caseSensitive = process.platform === "linux";
  const keys = new Set<string>();
  for (const [directory, logicalName] of [
    [layout.saveDirectory, "battery.srm"],
    [layout.stateDirectory, "state.state"],
  ] as const) {
    const name = retroArchPhysicalSaveName(layout.romPath, logicalName);
    if (directory && name) {
      keys.add(
        canonicalRestoreTargetKey(path.join(directory, name), caseSensitive)
      );
    }
  }
  return keys;
};

export const retroArchSaveLocationsOverlap = (
  left: RetroArchSaveLayout,
  right: RetroArchSaveLayout
) => {
  const leftKeys = targetKeys(left);
  return [...targetKeys(right)].some((key) => leftKeys.has(key));
};
