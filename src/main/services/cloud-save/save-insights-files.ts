import type {
  GameShop,
  LocalGameSnapshotSourceFile,
  SaveSummary,
  SnapshotFile,
} from "@types";
import { logger } from "@main/services/logger";

import { NativeAddon, type NativeSaveInsightsFile } from "../native-addon";
import { parseSaveSummary } from "./save-insights-contract";

export const blobKey = (file: Pick<SnapshotFile, "hash" | "sizeBytes">) =>
  JSON.stringify([file.hash, file.sizeBytes]);

export const modifiedAtMs = (lastModifiedAt: string) => {
  const parsed = Date.parse(lastModifiedAt);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const summarizeSaveFiles = async (
  shop: GameShop,
  objectId: string,
  files: NativeSaveInsightsFile[]
): Promise<SaveSummary | null> => {
  if (files.length === 0) return null;
  try {
    return parseSaveSummary(
      await NativeAddon.summarizeSaveFiles(shop, objectId, files)
    );
  } catch (error) {
    logger.warn("[Cloud Save] Failed to summarize save files", {
      shop,
      objectId,
      error,
    });
    return null;
  }
};

export const summarizeLocalSourceFiles = (
  shop: GameShop,
  objectId: string,
  sourceFiles: LocalGameSnapshotSourceFile[]
) =>
  summarizeSaveFiles(
    shop,
    objectId,
    sourceFiles.map((file) => ({
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      path: file.absolutePath,
      sizeBytes: file.sizeBytes,
      modifiedAtMs: modifiedAtMs(file.lastModifiedAt),
    }))
  );
