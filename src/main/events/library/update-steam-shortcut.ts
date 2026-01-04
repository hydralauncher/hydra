import { registerEvent } from "../register-event";
import type { GameShop, SteamShortcut } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLocation, getSteamUsersIds, logger } from "@main/services";
import { parseBuffer, writeBuffer } from "steam-shortcut-editor";
import fs from "node:fs";
import path from "node:path";

const editSteamShortcut = async (
  steamUserId: number,
  match: (shortcut: SteamShortcut) => boolean,
  update: Partial<SteamShortcut>
) => {
  const shortcutsPath = path.join(
    await getSteamLocation(),
    "userdata",
    steamUserId.toString(),
    "config",
    "shortcuts.vdf"
  );

  if (!fs.existsSync(shortcutsPath)) {
    logger.error("shortcuts.vdf not found", shortcutsPath);
    throw new Error("shortcuts.vdf not found");
  }

  const parsed = parseBuffer(fs.readFileSync(shortcutsPath)) as {
    shortcuts: SteamShortcut[];
  };

  const shortcut = parsed.shortcuts.find(match);

  if (!shortcut) {
    logger.error("Steam shortcut not found for user", steamUserId);
    throw new Error("Steam shortcut not found");
  }

  Object.assign(shortcut, update);

  const buffer = writeBuffer(parsed);
  await fs.promises.writeFile(shortcutsPath, buffer);

  logger.info("Updated Steam shortcut", shortcut);
};

const updateSteamShortcut = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game?.executablePath) return;
  if (!game.steamShortcutAppId) return;

  const steamAppId = game.steamShortcutAppId;
  const steamUserIds = await getSteamUsersIds();

  for (const steamUserId of steamUserIds) {
    try {
      const update: Partial<SteamShortcut> = {
        OpenVR: Boolean(game.launchInVR),
      };

      if (game.launchOptions !== null) {
        update.LaunchOptions = `"${game.launchOptions}"`;
      }

      await editSteamShortcut(
        steamUserId,
        (s) => s.appid === steamAppId,
        update
      );

      // Update Steam grid icon
      const gridPath = path.join(
        await getSteamLocation(),
        "userdata",
        steamUserId.toString(),
        "config",
        "grid"
      );

      const iconPath = game.customOriginalIconPath ?? game.originalIconPath;

      if (iconPath && fs.existsSync(iconPath)) {
        await fs.promises.mkdir(gridPath, { recursive: true });
        await fs.promises.cp(
          iconPath,
          path.join(gridPath, `${steamAppId}.ico`)
        );
        logger.info("Updated Steam grid icon", iconPath);
      }
    } catch (error) {
      logger.error(
        `Failed to update Steam shortcut for user ${steamUserId}`,
        error
      );
    }
  }
};

registerEvent("updateSteamShortcut", updateSteamShortcut);
