import type { CloudSaveV2FileDetails, GameShop } from "@types";

import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { buildCloudSaveV2FileDetails } from "./cloud-save-v2-file-details";
import { getUsableCloudSaveCustomPathBindings } from "./custom-path-overlap";
import { getEmulatorSaveProvider } from "./emulator-save-provider";
import { setRetroArchFileDisplayNames } from "./retroarch-file-display-names";

export const getLocalSaveFileDetails = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveV2FileDetails> => {
  const context = await getCloudSaveGameContext(objectId, shop);
  const customPathBindings = await getUsableCloudSaveCustomPathBindings(
    objectId,
    shop,
    context
  ).catch(() => ({ ready: [], unresolved: [] }));
  const local = await buildLocalGameSnapshotContext(objectId, shop, context, {
    customPathBindings,
  });

  const details = buildCloudSaveV2FileDetails({
    state: "untracked",
    localVariants: local.variants,
    localFiles: local.files,
    localSourceFiles: local.sourceFiles,
    localTotalSizeBytes: local.totalSizeBytes,
    activeSnapshot: null,
    remoteVariants: [],
    remoteFiles: [],
    coverage: local.coverage,
  });

  const game = context.game;
  if (game && getEmulatorSaveProvider(game) === "retroarch") {
    const activeLocation = await import("./retroarch-save-provider")
      .then(({ locationsForGame }) => locationsForGame(game))
      .then((locations) => locations.activeLocation)
      .catch(() => null);
    const stateBindings = activeLocation
      ? await import("./retroarch-state-bindings")
          .then(({ loadRetroArchBindings }) => loadRetroArchBindings(game))
          .then((bindings) => bindings.states)
          .catch(() => undefined)
      : undefined;
    setRetroArchFileDisplayNames(
      details,
      activeLocation ?? null,
      stateBindings
    );
  }

  return details;
};
