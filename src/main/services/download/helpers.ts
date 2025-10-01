import path from "node:path";
import fs from "node:fs";
import { logger } from "../logger";

export const calculateETA = (
  totalLength: number,
  completedLength: number,
  speed: number
) => {
  const remainingBytes = totalLength - completedLength;

  if (remainingBytes >= 0 && speed > 0) {
    return (remainingBytes / speed) * 1000;
  }

  return -1;
};

export const getDirSize = async (dir: string): Promise<number> => {
  try {
    const stat = await fs.promises.stat(dir);

    // If it's a file, return its size directly
    if (!stat.isDirectory()) {
      return stat.size;
    }

    const getItemSize = async (filePath: string): Promise<number> => {
      const stat = await fs.promises.stat(filePath);

      if (stat.isDirectory()) {
        return getDirSize(filePath);
      }

      return stat.size;
    };

    const files = await fs.promises.readdir(dir);
    const filePaths = files.map((file) => path.join(dir, file));
    const sizes = await Promise.all(filePaths.map(getItemSize));

    return sizes.reduce((total, size) => total + size, 0);
  } catch (error) {
    logger.error(error);
    return 0;
  }
};
