import { registerEvent } from "../register-event";
import path from "node:path";
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
    const shortcutArguments = getHydraShortcutTarget(deepLink, false).arguments;
    return (
      shortcut.LaunchOptions === shortcutArguments ||
      shortcut.LaunchOptions === getShortcutArguments(deepLink)
    );
  }

  const shortcutExecutable = shortcut.Exe.trim().replace(/^"|"$/g, "");
  const caseInsensitive =
    process.platform === "win32" ||
    path.extname(game.executablePath ?? "").toLowerCase() === ".exe";
  const executableMatches = caseInsensitive
    ? shortcutExecutable.toLowerCase() === game.executablePath?.toLowerCase()
    : shortcutExecutable === game.executablePath;
  return (
    (game.executablePath && executableMatches) ||
    shortcut.appname === game.title
  );
};

const persistSteamShortcutAppId = async (
  gameKey: string,
  game: Game,
  shortcut: SteamShortcut
) => {
  if (!shortcut.appid || game.steamShortcutAppId === shortcut.appid) return;

  const updatedGame = {
    ...game,
    steamShortcutAppId: shortcut.appid,
  };
  await gamesSublevel.put(gameKey, updatedGame);

  logger.info("Updated Steam shortcut app id", shortcut.appid);
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

  await persistSteamShortcutAppId(gameKey, game, match);

  return true;
};

registerEvent("checkSteamShortcut", checkSteamShortcut);
