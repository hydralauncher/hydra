import type { CloudSaveCustomPath, GameShop } from "@types";

import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getCloudSaveCustomPathSelectionFailure } from "./custom-path-selection-policy";
import {
  discoverEmulatorSaveFiles,
  getEmulatorGameSaveFileFilter,
  getEmulatorSaveProvider,
} from "./emulator-save-provider";
import { isEligibleEmulatorManualFile } from "./emulator-manual-file-eligibility.js";

type CloudSaveGameContext = Awaited<ReturnType<typeof getCloudSaveGameContext>>;

export const assertCloudSaveCustomPathHasEligibleFiles = async (
  objectId: string,
  shop: GameShop,
  context: CloudSaveGameContext,
  customPath: CloudSaveCustomPath
) => {
  if (
    customPath.kind === "file" &&
    context.game &&
    getEmulatorSaveProvider(context.game) &&
    !(await isEligibleEmulatorManualFile(
      context.game,
      customPath.path,
      await getEmulatorGameSaveFileFilter(context.game)
    ))
  ) {
    throw new Error("cloud_save_custom_path_empty");
  }
  const snapshot = await buildLocalGameSnapshotContext(
    objectId,
    shop,
    context,
    {
      customPathBindings: { ready: [customPath], unresolved: [] },
    }
  );

  if (context.game && getEmulatorSaveProvider(context.game)) {
    const { discovery } = await discoverEmulatorSaveFiles(
      context.game,
      context.environmentId
    );
    const selected = customPath.path;
    const containsProviderFile = discovery.files.some((file) =>
      customPath.kind === "file"
        ? file.absolutePath === selected
        : file.absolutePath.startsWith(`${selected}/`) ||
          file.absolutePath.startsWith(`${selected}\\`)
    );
    if (containsProviderFile) return;
  }

  const failure = getCloudSaveCustomPathSelectionFailure(
    snapshot.files,
    snapshot.coverage,
    customPath.rawPath
  );
  if (failure === "environment-unavailable") {
    throw new Error("cloud_save_custom_path_environment_unavailable");
  }
  if (failure === "foreign-environment") {
    throw new Error("cloud_save_custom_path_foreign_environment");
  }
  if (failure === "unreadable") {
    throw new Error("cloud_save_custom_path_unreadable");
  }
  if (failure === "empty") {
    throw new Error("cloud_save_custom_path_empty");
  }
};
