import type { GameShop } from "@types";

export type CloudSavePendingDeletionPhase = "prepared" | "remote-started";

export interface StoredCloudSavePendingDeletion {
  schemaVersion: 1;
  phase: CloudSavePendingDeletionPhase;
}

export const cloudSavePendingDeletionStorageKey = (
  userId: string,
  shop: GameShop,
  objectId: string
) => JSON.stringify([userId, shop, objectId]);

export const resolveCloudSavePendingDeletionPhase = (
  value: unknown
): CloudSavePendingDeletionPhase | null => {
  if (value === undefined) return null;
  if (
    value &&
    typeof value === "object" &&
    (value as Partial<StoredCloudSavePendingDeletion>).schemaVersion === 1 &&
    ((value as Partial<StoredCloudSavePendingDeletion>).phase === "prepared" ||
      (value as Partial<StoredCloudSavePendingDeletion>).phase ===
        "remote-started")
  ) {
    return (value as StoredCloudSavePendingDeletion).phase;
  }

  return "remote-started";
};
