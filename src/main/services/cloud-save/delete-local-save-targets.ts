import type { Game, LocalGameSnapshotContext } from "@types";

import { NativeAddon } from "../native-addon";
import { logger } from "../logger";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { buildNativeDeleteTargets } from "./build-native-delete-targets";
import { deleteEmulatorCardSaves } from "./delete-emulator-card-saves";

export const deleteLocalSaveTargets = async (
  context: LocalGameSnapshotContext,
  entryIds: string[],
  assertEnvironmentCurrent?: () => Promise<void>,
  cleanupRootPaths: string[] = [],
  game?: Game | null
) => {
  const requestedIds = new Set(entryIds);
  const sourceFiles = context.sourceFiles.filter((file) =>
    requestedIds.has(cloudSaveFileKey(file))
  );
  if (sourceFiles.length !== requestedIds.size) {
    throw new Error("cloud_save_delete_local_target_missing");
  }
  if (sourceFiles.length === 0) {
    return {
      deletedFiles: [],
      deletedDirectories: [],
      cleanupFailureCount: 0,
    };
  }

  await assertEnvironmentCurrent?.();
  const targets = await buildNativeDeleteTargets(sourceFiles);
  const result = await deleteEmulatorCardSaves(
    game,
    sourceFiles,
    () => NativeAddon.deleteLocalSaveTargets(targets, cleanupRootPaths),
    assertEnvironmentCurrent
  );
  if (result.cleanupFailureCount > 0) {
    logger.warn("[Cloud Save] Failed to clean committed delete artifacts", {
      cleanupFailureCount: result.cleanupFailureCount,
    });
  }
  return result;
};
