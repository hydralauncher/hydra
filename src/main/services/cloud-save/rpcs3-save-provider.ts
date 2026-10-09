import { logger } from "@main/services/logger";

import type { Game } from "@types";

import { getEmulatorConfig } from "../emulators/emulators-repository";
import { rpcs3ConfigRoots } from "../emulators/emulator-config";
import {
  emulatorSaveFileKey,
  emulatorRestoreRule,
} from "./emulator-provider-identity";
import type {
  EmulatorProvider,
  EmulatorProviderContext,
} from "./emulator-provider-types";
import { getRpcs3SavedataTitleIds } from "./rpcs3-savedata-title-ids.js";
import { rpcs3TitleIdsForGame } from "./rpcs3-title-ids.js";
import {
  resolveRpcs3ConfigRootStatus,
  rpcs3Hdd0Root,
} from "./rpcs3-config-root";
import {
  scanRpcs3Gamedata,
  scanRpcs3SaveRoot,
  scanRpcs3Savestates,
  unresolvedCoverage,
} from "./rpcs3-save-scanner";
import { resolveRpcs3GamedataRestoreRule } from "./rpcs3-gamedata-restore.js";
import { resolveRpcs3SavestateRestoreRule } from "./rpcs3-savestate-restore";
import {
  ensureRpcs3RestoredUserNames,
  resolveRpcs3SavedataRestoreRule,
} from "./rpcs3-savedata-restore.js";

export const resolveRpcs3SaveLocation = async () => {
  const emulator = await getEmulatorConfig("ps3");
  const { status, location } = await resolveRpcs3ConfigRootStatus(
    emulator.executablePath,
    emulator.rpcs3ConfigRoot
  );
  if (location) return location;
  logger.warn("[Cloud Save] RPCS3 config root unavailable", {
    status: status.status,
    selectedRoot: status.selectedRoot,
    checkedPaths: rpcs3ConfigRoots(emulator.executablePath),
  });
  const code = {
    "not-configured": "cloud_save_rpcs3_not_configured",
    missing: "cloud_save_rpcs3_config_missing",
    ambiguous: "cloud_save_rpcs3_config_ambiguous",
    "invalid-selection": "cloud_save_rpcs3_config_invalid_selection",
    ready: "cloud_save_rpcs3_config_missing",
  }[status.status];
  throw new Error(code);
};

export const getRpcs3SaveEnvironmentKey = async () => {
  const resolved = await resolveRpcs3SaveLocation().catch(() => null);
  return resolved
    ? JSON.stringify(["rpcs3-all-profiles-v1", resolved])
    : "rpcs3-save-root-unresolved";
};

export const rpcs3SaveProvider: EmulatorProvider = {
  async discover(context: EmulatorProviderContext) {
    try {
      const { configRoot, homeRoot } = await resolveRpcs3SaveLocation();
      const rpcs3SavedataTitleIds =
        context.rpcs3SavedataTitleIds ??
        (await getRpcs3SavedataTitleIds(context.game));
      const [savedata, savestates, gamedata] = await Promise.all([
        scanRpcs3SaveRoot({ ...context, rpcs3SavedataTitleIds }, homeRoot),
        scanRpcs3Savestates(context, configRoot),
        scanRpcs3Gamedata(
          { ...context, rpcs3SavedataTitleIds },
          rpcs3Hdd0Root({ homeRoot })
        ),
      ]);
      return {
        files: [...savedata.files, ...savestates.files, ...gamedata.files],
        coverage: [
          ...savedata.coverage,
          ...savestates.coverage,
          ...gamedata.coverage,
        ],
        revision: "rpcs3-v4",
      };
    } catch {
      return {
        files: [],
        coverage: [unresolvedCoverage("rpcs3-vfs-unresolved")],
        revision: "rpcs3-v4",
      };
    }
  },
  async restoreRules(game: Game, files, rpcs3SavedataTitleIds) {
    if (!rpcs3TitleIdsForGame(game).length) return new Map();
    const allowedTitleIds = new Set(
      rpcs3SavedataTitleIds ?? (await getRpcs3SavedataTitleIds(game))
    );
    let homeRoot: string;
    let configRoot: string;
    try {
      ({ configRoot, homeRoot } = await resolveRpcs3SaveLocation());
    } catch {
      return new Map();
    }
    const resolveRule = async (file: (typeof files)[number]) =>
      (await resolveRpcs3SavestateRestoreRule(game, file, configRoot)) ??
      (await resolveRpcs3GamedataRestoreRule(
        file,
        allowedTitleIds,
        rpcs3Hdd0Root({ homeRoot })
      )) ??
      resolveRpcs3SavedataRestoreRule(file, allowedTitleIds, homeRoot);
    const resolved = await Promise.all(
      files.map(async (file) => [file, await resolveRule(file)] as const)
    );
    const rules = new Map<string, ReturnType<typeof emulatorRestoreRule>>();
    for (const [file, rule] of resolved) {
      if (rule) rules.set(emulatorSaveFileKey(file), rule);
    }
    return rules;
  },
  afterRestore(actions) {
    return ensureRpcs3RestoredUserNames(actions);
  },
};
