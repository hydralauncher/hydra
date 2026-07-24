import type { GameShop } from "@types";

import { getCloudSaveGameContext } from "./cloud-save-game-context";

export const CLOUD_SAVE_ENVIRONMENT_CHANGED_ERROR =
  "cloud_save_environment_changed_during_sync";

export const assertCloudSaveEnvironmentCurrent = async (
  objectId: string,
  shop: GameShop,
  expectedEnvironmentId: string
) => {
  const current = await getCloudSaveGameContext(objectId, shop);
  if (current.environmentId !== expectedEnvironmentId) {
    throw new Error(CLOUD_SAVE_ENVIRONMENT_CHANGED_ERROR);
  }
  return current;
};

export const isCloudSaveEnvironmentChangedError = (error: unknown) =>
  error instanceof Error &&
  error.message === CLOUD_SAVE_ENVIRONMENT_CHANGED_ERROR;
