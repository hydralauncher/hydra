import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { HydraApi } from "@main/services/hydra-api";
import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import type { GameShop } from "@types";

// Includes soft-deleted records: removing a game keeps its playtime for the review gate.
const getGameReviewPlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const storedGame = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!storedGame) return 0;

  return getDisplayedPlayTimeInMilliseconds(
    getContextualEpicGame(storedGame, HydraApi.getAuthContext())
  );
};

registerEvent("getGameReviewPlaytime", getGameReviewPlaytime);
