import type { CloudSaveStateResult, GameShop } from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";

export const getCloudSaveState = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveStateResult> => {
  const analysis = await analyzeCloudSaveState(objectId, shop);
  return analysis.state;
};
