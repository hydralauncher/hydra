import { registerEvent } from "../register-event";
import type { Game, GameShop, SteamShortcut } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamShortcuts, getSteamUsersIds, logger } from "@main/services";
import {
  buildRunDeepLink,
  getHydraShortcutTarget,
  getShortcutArguments,
} from "@main/helpers/shortcut-launch";

const findSteamShortcut = async (
  steamUserIds: number[],
  predicate: (shortcut: SteamShortcut) => boolean
) => {
  for (const userId of steamUserIds) {
    const shortcuts = await getSteamShortcuts(userId);
    const match = shortcuts.find(predicate);
    if (match) return match;
  }

  return null;
};

const matchesGameFallback = (game: Game, shortcut: SteamShortcut) => {
  if (game.shop === "launchbox") {
    const deepLink = buildRunDeepLink(game.shop, game.objectId);
    const shortcutArguments = getHydraShortcutTarget(deepLink).arguments;
    return (
      shortcut.LaunchOptions === shortcutArguments ||
      shortcut.LaunchOptions === getShortcutArguments(deepLink)
    );
  }

  return (
    (game.executablePath && shortcut.Exe === game.executablePath) ||
    shortcut.appname === game.title
  );
};

const persistSteamShortcutAppId = async (
  gameKey: string,
  game: Game,
  shortcut: SteamShortcut
) => {
  if (game.steamShortcutAppId || !shortcut.appid) return;

  const updatedGame = {
    ...game,
    steamShortcutAppId: shortcut.appid,
  };
  await gamesSublevel.put(gameKey, updatedGame);

  logger.info(
    "Updated game with steamShortcutAppId:",
    JSON.stringify(updatedGame, null, 2)
  );
};

const checkSteamShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game || (!game.executablePath && game.shop !== "launchbox")) {
    return false;
  }

  const steamUserIds = await getSteamUsersIds();
  if (!steamUserIds.length) return false;

  // Check by existing steamShortcutAppId first
  if (game.steamShortcutAppId) {
    const shortcut = await findSteamShortcut(
      steamUserIds,
      (item) =>
        item.appid === game.steamShortcutAppId &&
        (game.shop !== "launchbox" || matchesGameFallback(game, item))
    );
    if (shortcut) return true;
  }

  const match = await findSteamShortcut(steamUserIds, (shortcut) =>
    matchesGameFallback(game, shortcut)
  );
  if (!match) return false;

  logger.info(
    "Steam shortcut detected for game (before adding steamShortcutAppId):",
    JSON.stringify(game, null, 2)
  );
  logger.info("Matching Steam shortcut:", match);

  await persistSteamShortcutAppId(gameKey, game, match);
  logger.info("Displaying game object after Steam shortcut check:", game);

  return true;
};

registerEvent("checkSteamShortcut", checkSteamShortcut);
