import type {
  CloudSaveUploadProgress,
  GameShop,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash";
import { assertCloudSaveV2Eligible } from "./assert-cloud-save-executable";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { getCloudSaveCustomPathBindings } from "./custom-path-store";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import { assertEmulatorDiscIdentity } from "./emulator-disc-identity.js";
import { createGoogleDriveSnapshotFromLocalState } from "./create-google-drive-snapshot";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

/** Snapshot proposal overrides. `retroArchFormatVersion` is kept for callers. */
export interface PrepareLocalSnapshotOptions {
  baseVersion: number;
  retroArchFormatVersion?: 2;
  customPathRawPaths?: string[];
  variants?: SnapshotVariant[];
  files?: SnapshotFile[];
  aggregateHash?: string;
}

export interface CreateRemoteSnapshotOptions
  extends PrepareLocalSnapshotOptions {
  expectedSnapshotId?: string | null;
  unresolvedRemoteEntryIds?: string[];
  updateAnchor?: boolean;
  assertEnvironmentCurrent?: () => Promise<void>;
}

/**
 * Fork: Google Drive is the only snapshot store. The whole Hydra
 * prepare/commit transport is gone, so a commit is always a Drive manifest
 * write.
 */
export const createRemoteSnapshotFromLocalState = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext,
  options?: CreateRemoteSnapshotOptions
): Promise<RemoteGameSnapshot | null> => {
  const resolvedOptions = options ?? { baseVersion: 0 };
  const game = await assertCloudSaveV2Eligible(objectId, shop);
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const variants = resolvedOptions.variants ?? context.variants;
  const files: SnapshotFile[] = resolvedOptions.files ?? context.files;
  const saveIdentity = await assertEmulatorDiscIdentity(game);
  if (saveIdentity) {
    const bindings = await getCloudSaveCustomPathBindings(
      shop,
      objectId,
      cloudSaveCustomPathContextFromPathContext(context.pathContext)
    );
    saveIdentity.assertSnapshotFiles(files, bindings.ready);
  }
  const customPathRawPaths =
    resolvedOptions.customPathRawPaths ?? context.customPathRawPaths;
  const expectedAggregateHash =
    resolvedOptions.aggregateHash ??
    buildCloudSaveAggregateHash({ variants, files });

  return createGoogleDriveSnapshotFromLocalState({
    objectId,
    shop,
    context,
    files,
    variants,
    customPathRawPaths,
    aggregateHash: expectedAggregateHash,
    baseVersion: resolvedOptions.baseVersion,
    expectedSnapshotId: resolvedOptions.expectedSnapshotId ?? null,
    unresolvedRemoteEntryIds: resolvedOptions.unresolvedRemoteEntryIds,
    updateAnchor: resolvedOptions.updateAnchor,
    onProgress,
    assertEnvironmentCurrent: resolvedOptions.assertEnvironmentCurrent,
  });
};
