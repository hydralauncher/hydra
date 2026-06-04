import { registerEvent } from "../register-event";
import type { GameShop, UserPreferences } from "@types";
import { Ludusavi, Wine } from "@main/services";
import { db, gamesSublevel, levelKeys } from "@main/level";

const getGameBackupPreview = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const savesOnly =
    game?.cloudSyncSavesOnly ?? userPreferences?.cloudSyncSavesOnly ?? false;

  return Ludusavi.getBackupPreview(
    shop,
    objectId,
    Wine.getEffectivePrefixPath(game?.winePrefixPath, objectId),
    savesOnly
  );
};

registerEvent("getGameBackupPreview", getGameBackupPreview);
