import { logger } from "@main/services/logger";

import type { CloudSaveRule, Game } from "@types";

import { getEmulatorConfig } from "../emulators/emulators-repository";
import { emulatorSaveFileKey } from "./emulator-provider-identity";
import type {
  EmulatorProvider,
  EmulatorProviderContext,
} from "./emulator-provider-types";
import {
  resolveShadps4DataDirStatus,
  shadps4DataDirCandidates,
} from "./shadps4-data-dir";
import { getShadps4SavedataTitleIds } from "./shadps4-save-layout.js";
import { resolveShadps4SavedataRestoreRule } from "./shadps4-savedata-restore.js";
import {
  SHADPS4_DISCOVERY_REVISION,
  scanShadps4SaveRoot,
  shadps4UnresolvedCoverage,
} from "./shadps4-save-scanner";

export const resolveShadps4SaveLocation = async () => {
  const emulator = await getEmulatorConfig("ps4");
  const { status, location } = await resolveShadps4DataDirStatus(
    emulator.executablePath,
    emulator.shadps4DataDir
  );
  if (location) return location;
  logger.warn("[Cloud Save] shadPS4 data folder unavailable", {
    status: status.status,
    selectedRoot: status.selectedRoot,
    checkedPaths: shadps4DataDirCandidates(emulator.executablePath),
  });
  const code = {
    "not-configured": "cloud_save_shadps4_not_configured",
    missing: "cloud_save_shadps4_config_missing",
    ambiguous: "cloud_save_shadps4_config_ambiguous",
    "invalid-selection": "cloud_save_shadps4_config_invalid_selection",
    ready: "cloud_save_shadps4_config_missing",
  }[status.status];
  throw new Error(code);
};

export const getShadps4SaveEnvironmentKey = async () => {
  const resolved = await resolveShadps4SaveLocation().catch(() => null);
  return resolved
    ? JSON.stringify(["shadps4-all-users-v1", resolved.homeRoot])
    : "shadps4-save-root-unresolved";
};

export const shadps4SaveProvider: EmulatorProvider = {
  async discover(context: EmulatorProviderContext) {
    try {
      const { homeRoot } = await resolveShadps4SaveLocation();
      const savedataTitleIds =
        context.savedataTitleIds ??
        (await getShadps4SavedataTitleIds(context.game));
      return await scanShadps4SaveRoot(
        { ...context, savedataTitleIds },
        homeRoot
      );
    } catch {
      return {
        files: [],
        coverage: [shadps4UnresolvedCoverage("shadps4-data-dir-unresolved")],
        revision: SHADPS4_DISCOVERY_REVISION,
      };
    }
  },
  async restoreRules(game: Game, files, savedataTitleIds) {
    const allowed = new Set(
      savedataTitleIds ?? (await getShadps4SavedataTitleIds(game))
    );
    if (!allowed.size) return new Map();
    let homeRoot: string;
    try {
      ({ homeRoot } = await resolveShadps4SaveLocation());
    } catch {
      return new Map();
    }
    const rules = new Map<string, CloudSaveRule>();
    for (const file of files) {
      const rule = await resolveShadps4SavedataRestoreRule(
        file,
        allowed,
        homeRoot
      );
      if (rule) rules.set(emulatorSaveFileKey(file), rule);
    }
    return rules;
  },
};
