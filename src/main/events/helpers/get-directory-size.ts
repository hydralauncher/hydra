import path from "node:path";
import fs from "node:fs";

const SIZE_SCAN_CONCURRENCY = 4;

export const getDirectorySize = async (dirPath: string): Promise<number> => {
  let rootStat: fs.Stats;
  try {
    rootStat = await fs.promises.stat(dirPath);
  } catch {
    return 0;
  }
  if (rootStat.isFile()) return rootStat.size;
  if (!rootStat.isDirectory()) return 0;

  let totalSize = 0;
  const pending = [{ fullPath: dirPath, isDirectory: true }];

  // Bound metadata I/O instead of serially stat-ing every file or launching
  // an unbounded Promise.all over a large installation.
  while (pending.length > 0) {
    const batch = pending.splice(-SIZE_SCAN_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ fullPath, isDirectory }) => {
        try {
          if (!isDirectory) {
            const fileStat = await fs.promises.stat(fullPath);
            totalSize += fileStat.size;
            return;
          }

          const entries = await fs.promises.readdir(fullPath, {
            withFileTypes: true,
          });
          for (const entry of entries) {
            // Do not traverse symlinks, which may leave the installation or loop.
            if (entry.isDirectory() || entry.isFile()) {
              pending.push({
                fullPath: path.join(fullPath, entry.name),
                isDirectory: entry.isDirectory(),
              });
            }
          }
        } catch {
          // Skip paths that disappear or can't be accessed.
        }
      })
    );
  }

  return totalSize;
};
