import type { CloudSaveCustomPath, GameShop } from "@types";

import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";
import { hasEligibleCloudSaveCustomPathFiles } from "./custom-path-selection-policy";

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

  if (
    !hasEligibleCloudSaveCustomPathFiles(snapshot.files, customPath.rawPath)
  ) {
    throw new Error("cloud_save_custom_path_empty");
  }
};
