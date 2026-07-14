import { registerEvent } from "../register-event";
import { gamesArtworkSelectionSublevel, levelKeys } from "@main/level";
import { WindowManager } from "@main/services";
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

  const existing = await gamesArtworkSelectionSublevel.get(gameKey);
  const selected: GameArtworkSelection["selected"] = { ...existing?.selected };

  if (clear || !url || artworkId == null) {
    delete selected[type];
  } else {
    selected[type] = { url, artworkId };
  }

  if (!Object.keys(selected).length) {
    await gamesArtworkSelectionSublevel.del(gameKey);
    WindowManager.sendToAppWindows("on-library-batch-complete");
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

  return record;
};

registerEvent("setGameArtworkSelection", setGameArtworkSelection);
