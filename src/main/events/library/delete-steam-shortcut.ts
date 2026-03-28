import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  getSteamLocation,
  getSteamUsersIds,
  getSteamShortcuts,
  writeSteamShortcuts,
  logger,
} from "@main/services";
import fs from "node:fs";
import path from "node:path";

const deleteSteamShortcutHandler = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game?.executablePath) {
    logger.info(
      `[deleteSteamShortcut] No game or executable found for ${shop}-${objectId}`
    );
    return false;
  }

  if (!game.steamShortcutAppId) {
    logger.info(`[deleteSteamShortcut] No Steam App ID for ${game.title}`);
    return false;
  }

  const steamAppId = game.steamShortcutAppId;
  const steamUserIds = await getSteamUsersIds();

  if (!steamUserIds.length) {
    logger.error("[deleteSteamShortcut] No Steam users found");
    return false;
  }

  logger.info(
    `[deleteSteamShortcut] Removing Steam shortcut for ${game.title} (AppID: ${steamAppId})`
  );

  for (const steamUserId of steamUserIds) {
    const steamShortcuts = await getSteamShortcuts(steamUserId);

    const shortcutExists = steamShortcuts.some((s) => s.appid === steamAppId);
    if (!shortcutExists) {
      logger.info(
        `[deleteSteamShortcut] No matching shortcut for user ${steamUserId}`
      );
      continue;
    }

    // Filter out the shortcut
    const updatedShortcuts = steamShortcuts.filter(
      (s) => s.appid !== steamAppId
    );

    // Write back
    await writeSteamShortcuts(steamUserId, updatedShortcuts);
    logger.info(
      `[deleteSteamShortcut] Shortcut removed for user ${steamUserId}`
    );

    // Remove Steam grid assets
    const gridPath = path.join(
      await getSteamLocation(),
      "userdata",
      steamUserId.toString(),
      "config",
      "grid"
    );

    const assetFiles = [
      `${steamAppId}_hero.jpg`,
      `${steamAppId}_logo.png`,
      `${steamAppId}p.jpg`,
      `${steamAppId}.jpg`,
      `${steamAppId}.ico`,
    ];

    for (const file of assetFiles) {
      const filePath = path.join(gridPath, file);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        logger.info(`[deleteSteamShortcut] Deleted asset: ${file}`);
      }
    }
  }

  // Clear Steam shortcut AppID in DB
  await gamesSublevel.put(gameKey, {
    ...game,
    steamShortcutAppId: undefined,
  });

  logger.info(
    `[deleteSteamShortcut] Cleared steamShortcutAppId for ${game.title}`
  );

  return true;
};

registerEvent("deleteSteamShortcut", deleteSteamShortcutHandler);
