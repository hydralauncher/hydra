import type { PrepareSnapshotRequest } from "@types";

import {
  validateSnapshotFiles,
  validateSnapshotVariants,
} from "./cloud-save-contract.js";

export const buildPrepareSnapshotPayload = ({
  shop,
  objectId,
  platform,
  hostname,
  snapshotHash,
  baseVersion,
  variants,
  files,
}: PrepareSnapshotRequest): PrepareSnapshotRequest => {
  const validatedVariants = validateSnapshotVariants(variants, shop);
  const validatedFiles = validateSnapshotFiles(files, validatedVariants);

  return {
    shop,
    objectId,
    platform,
    ...(hostname ? { hostname } : {}),
    snapshotHash,
    baseVersion,
    variants: validatedVariants,
    files: validatedFiles,
  };
};
