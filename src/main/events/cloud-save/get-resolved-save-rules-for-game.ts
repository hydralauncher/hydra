import type { GameShop } from "@types";

import { getResolvedSaveRulesForGame } from "@main/services/cloud-save/get-resolved-save-rules-for-game";

import { registerEvent } from "../register-event";

const handleGetResolvedSaveRulesForGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  return getResolvedSaveRulesForGame(shop, objectId);
};

registerEvent("getResolvedSaveRulesForGame", handleGetResolvedSaveRulesForGame);
