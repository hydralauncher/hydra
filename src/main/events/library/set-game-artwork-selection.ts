import { registerEvent } from "../register-event";
import { gamesArtworkSelectionSublevel, levelKeys } from "@main/level";
import {
  WindowManager,
  saveSteamGridDbArtwork,
  deleteCustomArtwork,
} from "@main/services";
import type { ArtworkAssetType, GameArtworkSelection, GameShop } from "@types";

interface SetArtworkSelectionParams {
  shop: GameShop;
  objectId: string;
  type: ArtworkAssetType;
  url?: string;
  artworkId?: number;
  clear?: boolean;
}

const setGameArtworkSelection = async (
  _event: Electron.IpcMainInvokeEvent,
  params: SetArtworkSelectionParams
): Promise<GameArtworkSelection | null> => {
  const { shop, objectId, type, url, artworkId, clear } = params;
  const gameKey = levelKeys.game(shop, objectId);
  const isClearing = clear || !url || artworkId == null;

  const existing = await gamesArtworkSelectionSublevel.get(gameKey);
  const selected: GameArtworkSelection["selected"] = { ...existing?.selected };

  if (isClearing) {
    delete selected[type];
  } else {
    selected[type] = { url, artworkId };
  }

  const syncToCloud = () => {
    if (isClearing) {
      deleteCustomArtwork(shop, objectId, type).catch(() => {});
    } else if (url) {
      saveSteamGridDbArtwork(shop, objectId, type, url).catch(() => {});
    }
  };

  if (!Object.keys(selected).length) {
    await gamesArtworkSelectionSublevel.del(gameKey);
    WindowManager.sendToAppWindows("on-library-batch-complete");
    syncToCloud();
    return null;
  }

  const record: GameArtworkSelection = {
    objectId,
    shop,
    selected,
    updatedAt: Date.now(),
  };

  await gamesArtworkSelectionSublevel.put(gameKey, record);
  WindowManager.sendToAppWindows("on-library-batch-complete");
  syncToCloud();

  return record;
};

registerEvent("setGameArtworkSelection", setGameArtworkSelection);
