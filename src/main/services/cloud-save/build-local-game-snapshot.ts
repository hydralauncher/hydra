import { SystemPath } from "@main/services/system-path";
import type { GameShop, LocalGameSnapshotWithHash } from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";

export const buildLocalGameSnapshotContext = async (
  objectId: string,
  shop: GameShop
) => {
  const { game, pathContext } = await getCloudSaveGameContext(objectId, shop);
  return NativeAddon.buildLocalGameSnapshotPipeline({
    ...pathContext,
    title: game?.title,
    remoteId: game?.remoteId ?? undefined,
    userDataPath: SystemPath.getPath("userData"),
  });
};

export const buildLocalGameSnapshot = async (
  objectId: string,
  shop: GameShop
): Promise<LocalGameSnapshotWithHash> => {
  const { sourceFiles: _, ...snapshot } = await buildLocalGameSnapshotContext(
    objectId,
    shop
  );

  return snapshot;
};
