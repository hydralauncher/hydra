import fs from "node:fs/promises";
import path from "node:path";
import type { DiskUsage } from "@types";
import { logger } from "./logger";

const MAX_PARENT_LOOKUPS = 64;

const isMissingPathError = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const resolveExistingPath = async (targetPath: string) => {
  let currentPath = path.resolve(targetPath);

  for (let lookup = 0; lookup < MAX_PARENT_LOOKUPS; lookup += 1) {
    try {
      await fs.access(currentPath);
      return currentPath;
    } catch (error) {
      if (!isMissingPathError(error)) return null;

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) return null;

      currentPath = parentPath;
    }
  }

  return null;
};

export const getDiskUsage = async (
  targetPath: string
): Promise<DiskUsage | null> => {
  const existingPath = await resolveExistingPath(targetPath);

  if (!existingPath) {
    logger.error(`[DiskUsage] No existing path to measure for ${targetPath}`);
    return null;
  }

  try {
    const stats = await fs.statfs(existingPath);

    const blockSize = Number(stats.bsize);
    const free = Number(stats.bavail) * blockSize;
    const total = Number(stats.blocks) * blockSize;

    if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0) {
      logger.error(
        `[DiskUsage] Unusable statfs result for ${existingPath}: bsize=${stats.bsize}, bavail=${stats.bavail}, blocks=${stats.blocks}`
      );
      return null;
    }

    return { free: Math.max(0, free), total };
  } catch (error) {
    logger.error(`[DiskUsage] Failed to read ${existingPath}`, error);
    return null;
  }
};
