import type {
  CloudSaveAutomaticSyncEvent,
  CloudSaveAutomaticSyncTrigger,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { syncGameCloudSave } from "./sync-game-cloud-save";

const activeAutomaticSyncs = new Map<
  string,
  Promise<SyncGameCloudSaveResult | null>
>();

const gameKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);

const emitTerminalEvent = (event: CloudSaveAutomaticSyncEvent) => {
  WindowManager.sendToAppWindows("on-cloud-save-automatic-sync", event);
};

export const runAutomaticCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveAutomaticSyncTrigger
): Promise<SyncGameCloudSaveResult | null> => {
  if (
    shop !== "steam" ||
    !HydraApi.isLoggedIn() ||
    !HydraApi.hasActiveSubscription()
  ) {
    return null;
  }

  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!game?.executablePath) return null;

  const key = gameKey(objectId, shop);
  const activeSync = activeAutomaticSyncs.get(key);
  if (activeSync) return activeSync;

  const promise = syncGameCloudSave(objectId, shop, trigger)
    .then((result) => {
      const status = result.action === "conflict" ? "conflict" : "completed";
      logger.info("[Cloud Save] Automatic sync finished", {
        shop,
        objectId,
        trigger,
        action: result.action,
        initialState: result.initialState,
        finalState: result.finalState,
      });
      emitTerminalEvent({
        gameId: { objectId, shop },
        trigger,
        status,
        result,
      });
      return result;
    })
    .catch((error: unknown) => {
      logger.error("[Cloud Save] Automatic sync failed", {
        shop,
        objectId,
        trigger,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      emitTerminalEvent({
        gameId: { objectId, shop },
        trigger,
        status: "failed",
      });
      return null;
    })
    .finally(() => {
      if (activeAutomaticSyncs.get(key) === promise) {
        activeAutomaticSyncs.delete(key);
      }
    });

  activeAutomaticSyncs.set(key, promise);
  return promise;
};
