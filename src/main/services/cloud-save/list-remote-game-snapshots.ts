import { HydraApi } from "@main/services/hydra-api";
import type { GameShop, RemoteSnapshotSummary } from "@types";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const validateRemoteSnapshots = (value: unknown): RemoteSnapshotSummary[] => {
  if (!Array.isArray(value)) throw new Error("Invalid snapshots response");

  return value.map((snapshot) => {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Invalid snapshot response item");
    }

    const item = snapshot as Record<string, unknown>;
    if (
      !isNonEmptyString(item.id) ||
      (item.status !== "active" && item.status !== "historical") ||
      !isNonEmptyString(item.createdAt) ||
      !Number.isFinite(Date.parse(item.createdAt)) ||
      typeof item.fileCount !== "number" ||
      !Number.isInteger(item.fileCount) ||
      item.fileCount < 0 ||
      typeof item.totalSizeBytes !== "number" ||
      !Number.isFinite(item.totalSizeBytes) ||
      item.totalSizeBytes < 0 ||
      !isNonEmptyString(item.aggregateHash) ||
      typeof item.revision !== "number" ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 1 ||
      typeof item.schemaVersion !== "number" ||
      !Number.isSafeInteger(item.schemaVersion) ||
      item.schemaVersion < 1
    ) {
      throw new Error("Invalid snapshot response item");
    }

    return item as unknown as RemoteSnapshotSummary;
  });
};

export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
) =>
  validateRemoteSnapshots(
    await HydraApi.get<unknown>("/profile/cloud-saves/snapshots", {
      shop,
      objectId,
    })
  );
