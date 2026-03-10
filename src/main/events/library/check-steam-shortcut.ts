import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamShortcuts, getSteamUsersIds, logger } from "@main/services";

const checkSteamShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game?.executablePath) return false;

  const steamUserIds = await getSteamUsersIds();
  if (!steamUserIds.length) return false;

  // Check by existing steamShortcutAppId first
  if (game.steamShortcutAppId) {
    for (const userId of steamUserIds) {
      const shortcuts = await getSteamShortcuts(userId);
      if (shortcuts.some((s) => s.appid === game.steamShortcutAppId)) {
        return true;
      }
    }
  }

  // Fallback: check by executablePath or title
  for (const userId of steamUserIds) {
    const shortcuts = await getSteamShortcuts(userId);
    const match = shortcuts.find(
      (s) => s.Exe === game.executablePath || s.appname === game.title
    );

    if (match) {
      // Log the game object before adding steamShortcutAppId
      logger.info(
        "Steam shortcut detected for game (before adding steamShortcutAppId):",
        JSON.stringify(game, null, 2)
      );
      logger.info("Matching Steam shortcut:", match);

      // Add steamShortcutAppId to game if missing for better tracking
      if (!game.steamShortcutAppId && match.appid) {
        const updatedGame = {
          ...game,
          steamShortcutAppId: match.appid,
        };
        await gamesSublevel.put(gameKey, updatedGame);

        logger.info(
          "Updated game with steamShortcutAppId:",
          JSON.stringify(updatedGame, null, 2)
        );
      }

      logger.info("Displaying game object after Steam shortcut check:", game);

      return true;
    }
  }

  return false;
};

registerEvent("checkSteamShortcut", checkSteamShortcut);
