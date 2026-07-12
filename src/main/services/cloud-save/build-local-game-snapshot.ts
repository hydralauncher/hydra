import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLocation, getSteamUsersIds } from "@main/services/steam";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import type { GameShop, LocalGameSnapshotWithHash } from "@types";

import { NativeAddon } from "../native-addon";

export const buildLocalGameSnapshot = async (
  objectId: string,
  shop: GameShop
): Promise<LocalGameSnapshotWithHash> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const [steamPath, steamUserIds] = await Promise.all([
    getSteamLocation().catch(() => undefined),
    getSteamUsersIds(),
  ]);
  return NativeAddon.buildLocalGameSnapshotPipeline({
    shop,
    objectId,
    title: game?.title,
    remoteId: game?.remoteId ?? undefined,
    userDataPath: SystemPath.getPath("userData"),
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
  });
};
