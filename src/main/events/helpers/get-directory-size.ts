import path from "node:path";
import fs from "node:fs";

export const getDirectorySize = async (dirPath: string): Promise<number> => {
  let totalSize = 0;

  try {
    const stat = await fs.promises.stat(dirPath);

    if (stat.isFile()) {
      return stat.size;
    }

    if (!stat.isDirectory()) {
      return 0;
    }

    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      try {
        if (entry.isDirectory()) {
          totalSize += await getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          const fileStat = await fs.promises.stat(fullPath);
          totalSize += fileStat.size;
        }
      } catch {
        // Skip files that can't be accessed
      }
    }
  } catch {
    // Path doesn't exist or can't be read
  }

  return totalSize;
};
