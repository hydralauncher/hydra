import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { HydraApi } from "@main/services/hydra-api";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import type { GameShop } from "@types";

const getGameReviewPlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const recordIncludingRemoved = await gamesSublevel.get(
    levelKeys.game(shop, objectId)
  );
  if (!recordIncludingRemoved) return 0;

  return getDisplayedPlayTimeInMilliseconds(
    getContextualEpicGame(recordIncludingRemoved, HydraApi.getAuthContext())
  );
};

registerEvent("getGameReviewPlaytime", getGameReviewPlaytime);
