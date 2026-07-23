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
import { getCloudSaveAutomaticSyncEnabled } from "./automatic-sync-settings";
import { syncGameCloudSave } from "./sync-game-cloud-save";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getCloudSaveErrorDetails } from "./cloud-save-error-details";
import {
  canUploadCloudSaveAfterLaunch,
  consumeCloudSaveLaunchGuard,
} from "./launch-guard";
import { CloudSaveOperationCoordinator } from "./operation-coordinator";

const automaticSyncCoordinator =
  new CloudSaveOperationCoordinator<SyncGameCloudSaveResult | null>();

const gameKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);

const emitAutomaticSyncEvent = (event: CloudSaveAutomaticSyncEvent) => {
  WindowManager.sendToAppWindows("on-cloud-save-automatic-sync", event);
};

export const runAutomaticCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveAutomaticSyncTrigger,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null
): Promise<SyncGameCloudSaveResult | null> => {
  if (
    shop !== "steam" ||
    !HydraApi.isLoggedIn() ||
    (!HydraApi.hasActiveSubscription() && trigger === "post-exit")
  ) {
    return null;
  }

  if (!(await getCloudSaveAutomaticSyncEnabled(objectId, shop))) return null;

  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch((error: unknown) => {
      logger.error("[Cloud Save] Failed to inspect automatic sync game", {
        shop,
        objectId,
        trigger,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    });
  if (!game?.executablePath) return null;

  const context =
    suppliedContext ??
    (await getCloudSaveGameContext(objectId, shop).catch((error: unknown) => {
      logger.error("[Cloud Save] Failed to resolve automatic sync context", {
        shop,
        objectId,
        trigger,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      emitAutomaticSyncEvent({
        gameId: { objectId, shop },
        trigger,
        status: "failed",
      });
      return null;
    }));
  if (!context) return null;
  const key = gameKey(objectId, shop);
  const operationKey = JSON.stringify([
    trigger,
    context.environmentId,
    expectedRemoteHash === undefined
      ? ["anchor"]
      : ["expected", expectedRemoteHash],
  ]);

  return automaticSyncCoordinator.run(key, operationKey, () =>
    syncGameCloudSave(
      objectId,
      shop,
      trigger,
      (progress) => {
        emitAutomaticSyncEvent({
          gameId: { objectId, shop },
          trigger,
          status: "progress",
          progress,
        });
      },
      context,
      expectedRemoteHash
    )
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
        emitAutomaticSyncEvent({
          gameId: { objectId, shop },
          trigger,
          status,
          result,
        });
        return result;
      })
      .catch((error: unknown) => {
        const errorDetails = getCloudSaveErrorDetails(error);
        logger.error("[Cloud Save] Automatic sync failed", {
          shop,
          objectId,
          trigger,
          ...errorDetails,
        });
        emitAutomaticSyncEvent({
          gameId: { objectId, shop },
          trigger,
          status: "failed",
          errorCode:
            typeof errorDetails.errorCode === "string"
              ? errorDetails.errorCode
              : undefined,
        });
        return null;
      })
  );
};

export const runAutomaticCloudSavePostExit = async (
  objectId: string,
  shop: GameShop
): Promise<SyncGameCloudSaveResult | null> => {
  const guard = consumeCloudSaveLaunchGuard(objectId, shop);
  if (!guard?.uploadAllowed) {
    logger.warn("[Cloud Save] Post-exit upload blocked by launch guard", {
      shop,
      objectId,
      reason: guard ? "pre_launch_not_safe" : "missing_launch_guard",
    });
    return null;
  }

  const context = await getCloudSaveGameContext(objectId, shop).catch(
    (error: unknown) => {
      logger.error("[Cloud Save] Failed to verify post-exit environment", {
        shop,
        objectId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return null;
    }
  );
  if (
    !context ||
    !canUploadCloudSaveAfterLaunch(guard, context.environmentId)
  ) {
    logger.warn(
      "[Cloud Save] Post-exit upload blocked after environment change",
      {
        shop,
        objectId,
      }
    );
    return null;
  }

  return runAutomaticCloudSaveSync(
    objectId,
    shop,
    "post-exit",
    context,
    guard.baseRemoteHash
  );
};
