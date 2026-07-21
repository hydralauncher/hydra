import { registerEvent } from "../register-event";
import { gamesArtworkSelectionSublevel, levelKeys } from "@main/level";
import type { GameArtworkSelection, GameShop } from "@types";

const getGameArtworkSelection = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<GameArtworkSelection | null> => {
  const selection = await gamesArtworkSelectionSublevel.get(
    levelKeys.game(shop, objectId)
  );

  return selection ?? null;
};

registerEvent("getGameArtworkSelection", getGameArtworkSelection);
