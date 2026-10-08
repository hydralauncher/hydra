import type { PrepareSnapshotRequest } from "@types";

import {
  validateCustomPathRawPaths,
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
  retroArchFormatVersion,
  customPathRawPaths,
  variants,
  files,
}: PrepareSnapshotRequest): PrepareSnapshotRequest => {
  const validatedVariants = validateSnapshotVariants(variants, shop);
  const validatedFiles = validateSnapshotFiles(files, validatedVariants);
  const validatedCustomPathRawPaths =
    validateCustomPathRawPaths(customPathRawPaths);
  const activeCustomPaths = new Set(validatedCustomPathRawPaths);
  if (
    validatedFiles.some(
      (file) =>
        file.rawPath.startsWith("<custom>") &&
        !activeCustomPaths.has(file.rawPath)
    )
  ) {
    throw new Error("Cloud Save custom file references an inactive path");
  }

  return {
    shop,
    objectId,
    platform,
    ...(hostname ? { hostname } : {}),
    snapshotHash,
    baseVersion,
    ...(retroArchFormatVersion === 2 ||
    validatedFiles.some((file) =>
      file.rawPath.startsWith("<emulator>/retroarch-v2/")
    )
      ? { retroArchFormatVersion: 2 as const }
      : {}),
    customPathRawPaths: validatedCustomPathRawPaths,
    variants: validatedVariants,
    files: validatedFiles,
  };
};
