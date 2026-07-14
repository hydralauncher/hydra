import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLocation } from "@main/services/steam";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import type { CloudSavePathContext, GameShop } from "@types";

const getCloudSavePlatform = (): CloudSavePathContext["platform"] => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
};

export const getCloudSaveGameContext = async (
  objectId: string,
  shop: GameShop
) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const steamPath = await getSteamLocation().catch(() => undefined);
  const pathContext: CloudSavePathContext = {
    shop,
    objectId,
    platform: getCloudSavePlatform(),
    homeDir: SystemPath.getPath("home"),
    documentsDir: SystemPath.getPath("documents") || undefined,
    appDataDir: SystemPath.getPath("appData") || undefined,
    executablePath: game?.executablePath ?? undefined,
    winePrefixPath:
      Wine.getEffectivePrefixPath(game?.winePrefixPath, objectId) ?? undefined,
    protonPath: game?.protonPath ?? undefined,
    steamPath,
  };

  return { game, pathContext };
};
