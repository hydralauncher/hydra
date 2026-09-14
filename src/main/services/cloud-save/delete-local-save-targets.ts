import type { DeleteLocalSaveTarget, LocalGameSnapshotContext } from "@types";

import { NativeAddon } from "../native-addon";
import { logger } from "../logger";
import { cloudSaveFileKey } from "./cloud-save-contract";

export const deleteLocalSaveTargets = async (
  context: LocalGameSnapshotContext,
  entryIds: string[],
  assertEnvironmentCurrent?: () => Promise<void>,
  cleanupRootPaths: string[] = []
) => {
  const requestedIds = new Set(entryIds);
  const targets: DeleteLocalSaveTarget[] = context.sourceFiles
    .filter((file) => requestedIds.has(cloudSaveFileKey(file)))
    .map((file) => ({
      variantId: file.variantId,
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      targetPath: file.absolutePath,
      restoreRootPath: file.localBindings.concretePath,
      expectedHash: file.hash,
      expectedSizeBytes: file.sizeBytes,
    }));

  if (targets.length !== requestedIds.size) {
    throw new Error("cloud_save_delete_local_target_missing");
  }
  if (targets.length === 0) {
    return {
      deletedFiles: [],
      deletedDirectories: [],
      cleanupFailureCount: 0,
    };
  }

  await assertEnvironmentCurrent?.();
  const result = await NativeAddon.deleteLocalSaveTargets(
    targets,
    cleanupRootPaths
  );
  if (result.cleanupFailureCount > 0) {
    logger.warn("[Cloud Save] Failed to clean committed delete artifacts", {
      cleanupFailureCount: result.cleanupFailureCount,
    });
  }
  return result;
};
