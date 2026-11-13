import fs from "node:fs";
import path from "node:path";

export const FILE_BATCH_SIZE = 16;

export const mapInBatches = <T, R>(
  items: T[],
  size: number,
  map: (item: T) => Promise<R>
) => {
  const batches = Array.from(
    { length: Math.ceil(items.length / size) },
    (_, index) => items.slice(index * size, (index + 1) * size)
  );
  return batches.reduce<Promise<R[]>>(async (previous, batch) => {
    const done = await previous;
    const mapped = await Promise.all(batch.map(map));
    return [...done, ...mapped];
  }, Promise.resolve([]));
};

export const findFirstInOrder = <T, R>(
  items: T[],
  find: (item: T) => Promise<R | null>
) =>
  items.reduce<Promise<R | null>>(async (previous, item) => {
    const found = await previous;
    return found ?? find(item);
  }, Promise.resolve(null));

interface FolderWalk {
  maxDepth: number;
  includeFile?: (name: string) => boolean;
  limit?: number;
  ignoreErrors?: boolean;
}

interface WalkLevel {
  folders: string[];
  files: string[];
}

const readFolder = (folder: string, ignoreErrors: boolean) => {
  const read = fs.promises.readdir(folder, { withFileTypes: true });
  return ignoreErrors ? read.catch(() => []) : read;
};

export const listFolderFiles = async (
  root: string,
  {
    maxDepth,
    includeFile = () => true,
    limit = Number.POSITIVE_INFINITY,
    ignoreErrors = false,
  }: FolderWalk
) => {
  const levels = Array.from({ length: maxDepth + 1 });
  const walked = await levels.reduce<Promise<WalkLevel>>(
    async (previous) => {
      const { folders, files } = await previous;
      if (folders.length === 0 || files.length >= limit) {
        return { folders: [], files };
      }
      const listings = await mapInBatches(folders, FILE_BATCH_SIZE, (folder) =>
        readFolder(folder, ignoreErrors)
      );
      const next: WalkLevel = { folders: [], files: [...files] };
      listings.forEach((entries, index) => {
        for (const entry of entries) {
          const entryPath = path.join(folders[index], entry.name);
          if (entry.isDirectory()) next.folders.push(entryPath);
          else if (entry.isFile() && includeFile(entry.name)) {
            next.files.push(entryPath);
          }
        }
      });
      return { folders: next.folders, files: next.files.slice(0, limit) };
    },
    Promise.resolve({ folders: [root], files: [] })
  );
  return walked.files;
};
