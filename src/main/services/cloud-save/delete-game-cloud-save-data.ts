import type { GameShop } from "@types";

import { HydraApi } from "../hydra-api";
import {
  getCloudSaveAutomaticSyncEnabled,
  setCloudSaveAutomaticSyncEnabled,
} from "./automatic-sync-settings";
import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { clearCloudSaveLocalState } from "./clear-cloud-save-local-state";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import {
  getCloudSaveCustomPathBindings,
  withCloudSaveCustomPathStoreMutation,
} from "./custom-path-store";
import {
  buildDeleteGameCloudSaveSnapshotsUrl,
  executeDeleteGameCloudSaveData,
} from "./delete-game-cloud-save-data-policy";
import { deleteLocalSaveTargets } from "./delete-local-save-targets";
import { assertCloudSaveEnvironmentCurrent } from "./environment-guard";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";

export const deleteGameCloudSaveData = async (
  objectId: string,
  shop: GameShop
) => {
  assertCloudSaveSubscription();

  return cloudSaveOperationGate.runDeletion(
    cloudSaveOperationScopeKey(objectId, shop),
    "delete-game-cloud-save-data",
    () => {
      let customPathStorageKey: string | null = null;
      return executeDeleteGameCloudSaveData({
        getAutomaticSyncEnabled: () =>
          getCloudSaveAutomaticSyncEnabled(objectId, shop),
        setAutomaticSyncEnabled: (enabled) =>
          setCloudSaveAutomaticSyncEnabled(objectId, shop, enabled),
        runWithLocalStateLock: (operation) =>
          withCloudSaveCustomPathStoreMutation(
            shop,
            objectId,
            async (storageKey) => {
              customPathStorageKey = storageKey;
              await operation();
            }
          ),
        prepareLocalDeletion: async () => {
          const analysis = await analyzeCloudSaveState(objectId, shop);
          const localEntryIds =
            analysis.localSnapshotContext.sourceFiles.map(cloudSaveFileKey);
          const bindings = await getCloudSaveCustomPathBindings(
            shop,
            objectId,
            cloudSaveCustomPathContextFromPathContext(
              analysis.context.pathContext
            )
          );
          const cleanupRootPaths = [
            ...bindings.ready.map((binding) => binding.path),
            ...analysis.localSnapshotContext.sourceFiles.map(
              (file) => file.localBindings.concretePath
            ),
          ];

          return async () => {
            await deleteLocalSaveTargets(
              analysis.localSnapshotContext,
              localEntryIds,
              () =>
                assertCloudSaveEnvironmentCurrent(
                  objectId,
                  shop,
                  analysis.environmentId
                ).then(() => undefined),
              cleanupRootPaths
            );
          };
        },
        deleteRemoteSnapshots: () =>
          HydraApi.delete<void>(
            buildDeleteGameCloudSaveSnapshotsUrl(objectId, shop),
            {
              needsAuth: true,
              needsSubscription: true,
            }
          ),
        clearLocalState: () => {
          if (!customPathStorageKey) {
            throw new Error("cloud_save_delete_local_state_lock_missing");
          }
          return clearCloudSaveLocalState(objectId, shop, customPathStorageKey);
        },
      });
    }
  );
};
