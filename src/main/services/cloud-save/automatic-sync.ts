import type {
  CloudSaveAutomaticSyncEvent,
  CloudSaveAutomaticSyncTrigger,
  CloudSaveSyncProgressStage,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

import { HydraApi } from "../hydra-api";
import { isGameRunning } from "../game-running-state";
import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { getCloudSaveAutomaticSyncEnabled } from "./automatic-sync-settings";
import { canAccessCloudSaves } from "./cloud-save-access";
import { syncGameCloudSave } from "./sync-game-cloud-save";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getCloudSaveErrorDetails } from "./cloud-save-error-details";
import { isCloudSaveEnvironmentChangedError } from "./environment-guard";
import { isCloudSaveExecutableMissingError } from "./executable-path-guard";
import {
  canUploadCloudSaveAfterLaunch,
  consumeCloudSaveLaunchGuard,
} from "./launch-guard";
import { CloudSaveOperationCoordinator } from "./operation-coordinator";
import {
  classifyAutomaticCloudSaveFailure,
  getPendingDeletionAutomaticSyncOutcome,
  type AutomaticCloudSaveSyncOutcome,
} from "./automatic-sync-outcome";
import { isCloudSaveDeletionPending } from "./pending-deletion";
import {
  beginAutomaticSyncObservation,
  finishAutomaticSyncObservation,
} from "./automatic-sync-observation";

const automaticSyncCoordinator =
  new CloudSaveOperationCoordinator<AutomaticCloudSaveSyncOutcome>();

const gameKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);

const isPendingDeletionBlockingAutomaticSync = async (
  objectId: string,
  shop: GameShop,
  trigger?: CloudSaveAutomaticSyncTrigger
) =>
  isCloudSaveDeletionPending(objectId, shop).catch((error: unknown) => {
    logger.error("[Cloud Save] Failed to inspect pending deletion", {
      shop,
      objectId,
      trigger,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return true;
  });

export const canRunAutomaticCloudSaveSync = async (
  objectId: string,
  shop: GameShop
) => {
  if (
    shop !== "steam" ||
    !canAccessCloudSaves(
      HydraApi.isLoggedIn(),
      HydraApi.hasActiveSubscription()
    ) ||
    (await isPendingDeletionBlockingAutomaticSync(objectId, shop)) ||
    !(await getCloudSaveAutomaticSyncEnabled(objectId, shop))
  ) {
    return false;
  }

  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  return Boolean(game?.executablePath);
};

const emitAutomaticSyncEvent = (event: CloudSaveAutomaticSyncEvent) => {
  WindowManager.sendToAppWindows("on-cloud-save-automatic-sync", event);
};

export const runAutomaticCloudSaveSyncDetailed = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveAutomaticSyncTrigger,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null
): Promise<AutomaticCloudSaveSyncOutcome> => {
  if (
    shop !== "steam" ||
    !canAccessCloudSaves(
      HydraApi.isLoggedIn(),
      HydraApi.hasActiveSubscription()
    )
  ) {
    return { status: "skipped", result: null };
  }

  const pendingDeletionOutcome = getPendingDeletionAutomaticSyncOutcome(
    await isPendingDeletionBlockingAutomaticSync(objectId, shop, trigger)
  );
  if (pendingDeletionOutcome) {
    logger.warn("[Cloud Save] Automatic sync blocked by pending deletion", {
      shop,
      objectId,
      trigger,
    });
    emitAutomaticSyncEvent({
      gameId: { objectId, shop },
      trigger,
      status: "cancelled",
    });
    return pendingDeletionOutcome;
  }

  if (!(await getCloudSaveAutomaticSyncEnabled(objectId, shop))) {
    return { status: "skipped", result: null };
  }

  let gameReadFailed = false;
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch((error: unknown) => {
      logger.error("[Cloud Save] Failed to inspect automatic sync game", {
        shop,
        objectId,
        trigger,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      gameReadFailed = true;
      return null;
    });
  if (!game?.executablePath) {
    return {
      status: gameReadFailed
        ? classifyAutomaticCloudSaveFailure(trigger)
        : "skipped",
      result: null,
    };
  }
  if (isGameRunning(objectId, shop)) {
    return { status: "skipped", result: null };
  }

  let contextResolutionFailed = false;
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
      contextResolutionFailed = true;
      return null;
    }));
  if (!context) {
    return {
      status: contextResolutionFailed
        ? classifyAutomaticCloudSaveFailure(trigger)
        : "skipped",
      result: null,
    };
  }
  const key = gameKey(objectId, shop);
  const operationKey = JSON.stringify([
    trigger,
    context.environmentId,
    expectedRemoteHash === undefined
      ? ["anchor"]
      : ["expected", expectedRemoteHash],
  ]);

  return automaticSyncCoordinator.run(key, operationKey, async () => {
    const observation =
      trigger === "game-page-open"
        ? beginAutomaticSyncObservation(objectId, shop, trigger)
        : ({ accepted: true, observationKey: null } as const);
    if (!observation.accepted) {
      return { status: "skipped", result: null };
    }

    let latestStage: CloudSaveSyncProgressStage | undefined;
    return syncGameCloudSave(
      objectId,
      shop,
      trigger,
      (progress) => {
        latestStage = progress.stage;
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
        finishAutomaticSyncObservation(
          objectId,
          shop,
          trigger,
          observation.observationKey,
          "settled"
        );
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
        return { status: "completed", result } as const;
      })
      .catch((error: unknown) => {
        const environmentChanged = isCloudSaveEnvironmentChangedError(error);
        const executableMissing = isCloudSaveExecutableMissingError(error);
        const gameRunning =
          error instanceof Error && error.message === "cloud_save_game_running";
        if (environmentChanged || executableMissing || gameRunning) {
          let cancellationReason = "environment_changed";
          if (executableMissing) {
            cancellationReason = "executable_missing";
          } else if (gameRunning) {
            cancellationReason = "game_running";
          }

          finishAutomaticSyncObservation(
            objectId,
            shop,
            trigger,
            observation.observationKey,
            "failed"
          );
          logger.info("[Cloud Save] Automatic sync cancelled", {
            shop,
            objectId,
            trigger,
            reason: cancellationReason,
          });
          emitAutomaticSyncEvent({
            gameId: { objectId, shop },
            trigger,
            status: "cancelled",
          });
          return { status: "cancelled", result: null } as const;
        }
        const errorDetails = getCloudSaveErrorDetails(error);
        finishAutomaticSyncObservation(
          objectId,
          shop,
          trigger,
          observation.observationKey,
          "failed"
        );
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
        return {
          status: classifyAutomaticCloudSaveFailure(trigger, latestStage),
          result: null,
          errorCode:
            typeof errorDetails.errorCode === "string"
              ? errorDetails.errorCode
              : undefined,
        } as AutomaticCloudSaveSyncOutcome;
      });
  });
};

export const runAutomaticCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveAutomaticSyncTrigger,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  expectedRemoteHash?: string | null
): Promise<SyncGameCloudSaveResult | null> =>
  (
    await runAutomaticCloudSaveSyncDetailed(
      objectId,
      shop,
      trigger,
      suppliedContext,
      expectedRemoteHash
    )
  ).result;

export const runAutomaticCloudSavePostExit = async (
  objectId: string,
  shop: GameShop
): Promise<SyncGameCloudSaveResult | null> => {
  const guard = consumeCloudSaveLaunchGuard(objectId, shop);
  if (
    !canAccessCloudSaves(
      HydraApi.isLoggedIn(),
      HydraApi.hasActiveSubscription()
    )
  ) {
    return null;
  }
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
