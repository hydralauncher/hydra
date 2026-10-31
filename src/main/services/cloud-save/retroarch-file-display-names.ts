import path from "node:path";

import type { RetroArchStateBinding } from "@main/level";
import type { CloudSaveV2FileDetails } from "@types";

import {
  parseRetroArchGameRawPath,
  parseRetroArchSaveRawPath,
  parseRetroArchStateRelativePath,
} from "./emulator-provider-identity.js";
import {
  retroArchTargetForFile,
  type RomSaveLocation,
} from "./retroarch-save-scanner.js";

const fileName = (filePath: string) =>
  path.posix.basename(filePath.replaceAll("\\", "/"));

const isRetroArchFile = (rawPath: string) =>
  Boolean(
    parseRetroArchGameRawPath(rawPath) || parseRetroArchSaveRawPath(rawPath)
  );

export const setRetroArchFileDisplayNames = (
  details: CloudSaveV2FileDetails,
  activeLocation: RomSaveLocation | null,
  stateBindings: readonly RetroArchStateBinding[] = []
) => {
  for (const file of details.local.files) {
    if (isRetroArchFile(file.rawPath)) {
      file.displayName = fileName(file.absolutePath);
    }
  }

  if (!activeLocation) return;

  for (const file of details.activeSnapshot?.files ?? []) {
    if (!isRetroArchFile(file.rawPath)) continue;

    const state = parseRetroArchGameRawPath(file.rawPath)
      ? parseRetroArchStateRelativePath(file.relativePath)
      : null;
    if (state) {
      const binding = stateBindings.find((item) => item.id === state.stateId);
      if (
        binding &&
        activeLocation.stateDirectory &&
        path.dirname(binding.path) === activeLocation.stateDirectory &&
        path.basename(binding.path) === `${activeLocation.stem}${binding.slot}`
      ) {
        file.displayName = `${fileName(binding.path)}${state.image ? ".png" : ""}`;
      }
      continue;
    }

    const target = retroArchTargetForFile(activeLocation, file.relativePath);
    if (target) file.displayName = fileName(target.filePath);
  }
};
