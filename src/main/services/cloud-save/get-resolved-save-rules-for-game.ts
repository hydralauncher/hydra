import type { GameShop, ResolvedGameSaveRules } from "@types";

import { getSaveRulesForGame } from "./save-manifest";
import { buildCloudSavePathResolutionContext } from "./path-resolution/context";
import { resolveSaveRules } from "./path-resolution/resolve-rules";

export const getResolvedSaveRulesForGame = async (
  shop: GameShop,
  objectId: string
): Promise<ResolvedGameSaveRules> => {
  const saveRules = await getSaveRulesForGame(shop, objectId);

  if (saveRules.manifestKey === null) {
    return {
      gameId: saveRules.gameId,
      manifestKey: null,
      rules: [],
    };
  }

  const context = await buildCloudSavePathResolutionContext(shop, objectId);

  return {
    gameId: saveRules.gameId,
    manifestKey: saveRules.manifestKey,
    rules: resolveSaveRules(saveRules.rules, context),
  };
};
