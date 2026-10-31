import type { CloudSaveCustomPathBindings, GameShop } from "@types";

import { HydraApi } from "../hydra-api.js";
import { assertCloudSaveV2Eligible } from "./assert-cloud-save-executable.js";
import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash.js";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot.js";
import { createRemoteSnapshotFromLocalState } from "./create-remote-snapshot-from-local-state.js";
import {
  buildCloudSaveCustomPathRemovalProposal,
  executeCloudSaveCustomPathRemoteRemoval,
} from "./custom-path-removal.js";
import { dismissPendingCloudSaveCustomPathApprovalForRawPath } from "./custom-path-approval.js";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path.js";
import { withCloudSaveCustomPathStoreMutation } from "./custom-path-store.js";
import { executeCloudSaveCustomPathUntracking } from "./custom-path-untracking-policy.js";
import { getCloudSaveGameContext } from "./cloud-save-game-context.js";
import { getEmulatorSaveProvider } from "./emulator-save-provider.js";
import { buildDeleteGameCloudSaveSnapshotsUrl } from "./delete-game-cloud-save-data-policy.js";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots.js";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate.js";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets.js";
import { shouldRetryCloudSaveConflict } from "./snapshot-retry-policy.js";

const publishCustomPathRemoval = async (
  objectId: string,
  shop: GameShop,
  rawPath: string,
  context: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  bindings: CloudSaveCustomPathBindings,
  attempt = 0
): Promise<void> => {
  try {
    const activeSnapshot = (await listRemoteGameSnapshots(objectId, shop))[0];
    if (!activeSnapshot) return;

    const manifest = await getRemoteSnapshotRestoreManifest(activeSnapshot);
    const proposal = buildCloudSaveCustomPathRemovalProposal(manifest, rawPath);
    if (getEmulatorSaveProvider(context.game) === "rpcs3") {
      const { assertRpcs3DiscIdentity, assertRpcs3SnapshotIdentity } =
        await import("./rpcs3-game-identity.js");
      assertRpcs3SnapshotIdentity(
        proposal.files,
        await assertRpcs3DiscIdentity(context.game!),
        bindings.ready
      );
    }
    await executeCloudSaveCustomPathRemoteRemoval({
      proposal,
      deleteSnapshot: () =>
        HydraApi.delete<void>(
          buildDeleteGameCloudSaveSnapshotsUrl(objectId, shop),
          {
            needsAuth: true,
            needsSubscription: true,
          }
        ),
      updateSnapshot: async () => {
        const aggregateHash = buildCloudSaveAggregateHash({
          variants: proposal.variants,
          files: proposal.files,
        });
        const localSnapshotContext = await buildLocalGameSnapshotContext(
          objectId,
          shop,
          context,
          { customPathBindings: bindings }
        );
        const committed = await createRemoteSnapshotFromLocalState(
          objectId,
          shop,
          undefined,
          localSnapshotContext,
          {
            baseVersion: activeSnapshot.version,
            expectedSnapshotId: activeSnapshot.id,
            customPathRawPaths: proposal.customPathRawPaths,
            variants: proposal.variants,
            files: proposal.files,
            aggregateHash,
            updateAnchor: false,
          }
        );
        if (!committed) {
          throw new Error("Cloud Save custom path removal was not committed");
        }
      },
    });
  } catch (error) {
    if (shouldRetryCloudSaveConflict(error, attempt)) {
      return publishCustomPathRemoval(
        objectId,
        shop,
        rawPath,
        context,
        bindings,
        attempt + 1
      );
    }
    throw error;
  }
};

export const untrackCloudSaveCustomPath = (
  objectId: string,
  shop: GameShop,
  rawPath: string
) => {
  if (!rawPath.startsWith("<custom>")) {
    throw new Error("cloud_save_custom_path_invalid");
  }

  const scopeKey = cloudSaveOperationScopeKey(objectId, shop);
  return cloudSaveOperationGate.runSync(
    scopeKey,
    JSON.stringify(["untrack-custom-path", rawPath]),
    async () => {
      await assertCloudSaveV2Eligible(objectId, shop);
      const context = await getCloudSaveGameContext(objectId, shop);
      const customPathContext = cloudSaveCustomPathContextFromPathContext(
        context.pathContext
      );
      return withCloudSaveCustomPathStoreMutation(
        shop,
        objectId,
        customPathContext,
        async (_storageKey, bindings, mutations) =>
          executeCloudSaveCustomPathUntracking({
            publishRemoval: () =>
              publishCustomPathRemoval(
                objectId,
                shop,
                rawPath,
                context,
                bindings
              ),
            removeBinding: () => mutations.remove(rawPath),
            dismissPendingApproval: () =>
              dismissPendingCloudSaveCustomPathApprovalForRawPath(
                shop,
                objectId,
                rawPath
              ),
          })
      );
    }
  );
};
