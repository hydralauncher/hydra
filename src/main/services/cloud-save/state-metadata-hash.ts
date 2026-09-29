import { createHash } from "node:crypto";

import type { SnapshotFile } from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";

export const foldStateMetadataIntoHash = (
  baseHash: string,
  files: SnapshotFile[]
) => {
  const states = files
    .filter((file) => file.stateMetadata)
    .map((file) => ({
      key: cloudSaveFileKey(file),
      emulatorId: file.stateMetadata!.emulatorId,
      coreId: file.stateMetadata!.coreId ?? null,
      version: file.stateMetadata!.version ?? null,
      hostPlatform: file.stateMetadata!.hostPlatform ?? null,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  if (states.length === 0) return baseHash;
  return createHash("sha256")
    .update(JSON.stringify({ version: 2, baseHash, states }))
    .digest("hex");
};
