import { registerEvent } from "../register-event";
import { gamesSublevel, downloadsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import {
  resolveAchievementCount,
  resolveUnlockedAchievementCount,
} from "@main/services/achievements/achievement-memory-store";
import { lookupCachedPlatform } from "./get-library";

const getGameByObjectId = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const [game, download] = await Promise.all([
    gamesSublevel.get(gameKey),
    downloadsSublevel.get(gameKey),
  ]);

  if (!game || game.isDeleted) return null;

  if (game.shop === "launchbox" && !game.platform) {
    const cachedPlatform = await lookupCachedPlatform(gameKey);
    if (cachedPlatform) {
      game.platform = cachedPlatform;
      gamesSublevel.put(gameKey, game).catch(() => {});
    }
  }

  const unlockedAchievementCount = resolveUnlockedAchievementCount(
    shop,
    objectId,
    game.unlockedAchievementCount
  );
  const achievementCount = resolveAchievementCount(
    shop,
    objectId,
    game.achievementCount
  );

  return {
    ...game,
    id: gameKey,
    download,
    unlockedAchievementCount,
    achievementCount,
  };
};

registerEvent("getGameByObjectId", getGameByObjectId);
