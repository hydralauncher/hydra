import { HydraApi } from "@main/services/hydra-api";
import type { CloudSaveHeadResponse, GameShop } from "@types";

import { NativeAddon } from "../native-addon";
import {
  isNonEmptyString,
  validateUniqueLogicalFiles,
} from "./cloud-save-contract";

const validateHead = (value: unknown): CloudSaveHeadResponse => {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid Cloud Save head response");
  }
  const head = value as Record<string, unknown>;
  if (
    typeof head.revision !== "number" ||
    !Number.isSafeInteger(head.revision) ||
    head.revision < 0 ||
    (head.snapshotId !== null && !isNonEmptyString(head.snapshotId)) ||
    (head.snapshotHash !== null && !isNonEmptyString(head.snapshotHash)) ||
    (head.schemaVersion !== null &&
      (typeof head.schemaVersion !== "number" ||
        !Number.isSafeInteger(head.schemaVersion) ||
        head.schemaVersion < 1))
  ) {
    throw new Error("Invalid Cloud Save head response");
  }
  const files = validateUniqueLogicalFiles(head.files);
  if (
    (head.snapshotId === null) !== (head.snapshotHash === null) ||
    (head.snapshotId === null) !== (head.schemaVersion === null) ||
    (head.snapshotId === null && (head.revision !== 0 || files.length > 0))
  ) {
    throw new Error("Inconsistent Cloud Save head response");
  }
  return { ...(head as unknown as CloudSaveHeadResponse), files };
};

export const getCloudSaveHead = async (objectId: string, shop: GameShop) => {
  const head = validateHead(
    await HydraApi.get<unknown>("/profile/cloud-saves/head", {
      shop,
      objectId,
    })
  );
  if (
    head.snapshotHash &&
    NativeAddon.buildSnapshotAggregateHash({
      schemaVersion: head.schemaVersion!,
      saveNamespaceKey: `${shop}:${objectId}`,
      files: head.files,
    }) !== head.snapshotHash
  ) {
    throw new Error("Cloud Save head aggregate hash is inconsistent");
  }
  return head;
};
