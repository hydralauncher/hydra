import { randomUUID } from "node:crypto";

import type {
  CloudSaveCustomPathApproval,
  GameShop,
  RestoreManifestFile,
} from "@types";

const getFileName = (relativePath: string) =>
  relativePath.replaceAll("\\", "/").split("/").findLast(Boolean) ??
  relativePath;

export const buildCloudSaveCustomPathRebindApproval = ({
  gameId,
  rawPath,
  suggestedPath,
  selectedPath,
  canUseSuggestedPath,
  remoteFiles,
  snapshot,
}: {
  gameId: { shop: GameShop; objectId: string };
  rawPath: string;
  suggestedPath: string | null;
  selectedPath: string | null;
  canUseSuggestedPath: boolean;
  remoteFiles: RestoreManifestFile[];
  snapshot: { id: string; version: number } | null;
}): CloudSaveCustomPathApproval => {
  const files = remoteFiles
    .filter((file) => file.rawPath === rawPath)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    id: randomUUID(),
    gameId,
    purpose: "custom-path-rebind",
    rawPath,
    suggestedPath,
    selectedPath,
    canUseSuggestedPath,
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    files: files.map((file) => ({
      name: getFileName(file.relativePath),
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: file.lastModifiedAt,
    })),
    snapshotId: snapshot?.id ?? null,
    snapshotVersion: snapshot?.version ?? null,
  };
};
