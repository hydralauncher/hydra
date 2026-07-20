import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLocation } from "@main/services/steam";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import { logger } from "@main/services/logger";
import type { CloudSavePathContext, GameShop } from "@types";

import {
  resolveCloudSaveEnvironment,
  type CloudSavePrefixGenerationOverride,
} from "./cloud-save-environment";

export interface CloudSaveGameContextOverrides {
  executablePath?: string;
  winePrefixPath?: string | null;
  prefixGenerationOverride?: CloudSavePrefixGenerationOverride;
}

const getCloudSavePlatform = (): CloudSavePathContext["platform"] => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
};

export const getCloudSaveGameContext = async (
  objectId: string,
  shop: GameShop,
  overrides?: CloudSaveGameContextOverrides
) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const steamPath = await getSteamLocation().catch(() => undefined);
  const platform = getCloudSavePlatform();
  const executablePath =
    overrides?.executablePath ?? game?.executablePath ?? undefined;
  const usesWindowsCompatibility =
    platform === "linux" && executablePath?.toLowerCase().endsWith(".exe");
  const pathContext: CloudSavePathContext = {
    shop,
    objectId,
    platform,
    homeDir: SystemPath.getPath("home"),
    documentsDir: SystemPath.getPath("documents") || undefined,
    appDataDir: SystemPath.getPath("appData") || undefined,
    executablePath,
    winePrefixPath: usesWindowsCompatibility
      ? overrides && "winePrefixPath" in overrides
        ? (overrides.winePrefixPath ?? undefined)
        : (Wine.getEffectivePrefixPath(game?.winePrefixPath, objectId) ??
          undefined)
      : undefined,
    steamPath,
  };

  let winePrefixIsValid = false;
  if (pathContext.winePrefixPath) {
    try {
      winePrefixIsValid = Wine.validatePrefix(pathContext.winePrefixPath);
    } catch {
      winePrefixIsValid = false;
    }
  }
  const environment = await resolveCloudSaveEnvironment(pathContext, {
    winePrefixIsValid,
    prefixGenerationOverride: overrides?.prefixGenerationOverride,
  });
  if (winePrefixIsValid && environment.prefixIdentityMode !== "marker") {
    logger.warn(
      "[Cloud Save] Wine prefix marker unavailable; using degraded identity",
      { prefixIdentityMode: environment.prefixIdentityMode }
    );
  }

  return { game, ...environment };
};
