import { registerEvent } from "../register-event";
import { gamesSgdbSelectionSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const getSteamGridDbSelection = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const record = await gamesSgdbSelectionSublevel.get(
    levelKeys.game(shop, objectId)
  );

  return record ?? null;
};

registerEvent("getSteamGridDbSelection", getSteamGridDbSelection);
