import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLocation, getSteamUsersIds } from "@main/services/steam";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import type { CloudSavePathContext, GameShop } from "@types";

export const getCloudSaveGameContext = async (
  objectId: string,
  shop: GameShop
) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const [steamPath, steamUserIds] = await Promise.all([
    getSteamLocation().catch(() => undefined),
    getSteamUsersIds(),
  ]);
  const pathContext: CloudSavePathContext = {
    shop,
    objectId,
    platform: process.platform === "win32" ? "windows" : "linux",
    homeDir: SystemPath.getPath("home"),
    documentsDir: SystemPath.getPath("documents") || undefined,
    appDataDir: SystemPath.getPath("appData") || undefined,
    executablePath: game?.executablePath ?? undefined,
    winePrefixPath:
      Wine.getEffectivePrefixPath(game?.winePrefixPath, objectId) ?? undefined,
    protonPath: game?.protonPath ?? undefined,
    steamPath,
    steamUserIds: steamUserIds.map(String),
  };

  return { game, pathContext };
};
