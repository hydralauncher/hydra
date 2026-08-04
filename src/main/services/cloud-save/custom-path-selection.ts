import type { CloudSaveCustomPath, GameShop } from "@types";

import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getCloudSaveCustomPathSelectionFailure } from "./custom-path-selection-policy";

type CloudSaveGameContext = Awaited<ReturnType<typeof getCloudSaveGameContext>>;

export const assertCloudSaveCustomPathHasEligibleFiles = async (
  objectId: string,
  shop: GameShop,
  context: CloudSaveGameContext,
  customPath: CloudSaveCustomPath
) => {
  const snapshot = await buildLocalGameSnapshotContext(
    objectId,
    shop,
    context,
    {
      customPathBindings: { ready: [customPath], unresolved: [] },
    }
  );

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
