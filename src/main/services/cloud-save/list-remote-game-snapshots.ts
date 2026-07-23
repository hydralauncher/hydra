import { HydraApi } from "@main/services/hydra-api";
import type { GameShop, RemoteSnapshotSummary } from "@types";

import { validateRemoteSnapshotSummary } from "./cloud-save-contract";

const validateRemoteSnapshots = (value: unknown): RemoteSnapshotSummary[] => {
  if (!Array.isArray(value)) throw new Error("Invalid snapshots response");
  if (value.length > 1) {
    throw new Error("Cloud Save API returned more than one active snapshot");
  }
  return value.map(validateRemoteSnapshotSummary);
};

export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
) =>
  validateRemoteSnapshots(
    await HydraApi.get<unknown>(
      "/profile/cloud-saves/snapshots",
      {
        shop,
        objectId,
      },
      {
        needsAuth: true,
        needsSubscription: true,
      }
    )
  );
