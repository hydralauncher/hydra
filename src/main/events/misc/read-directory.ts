import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { registerEvent } from "../register-event";

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  extension: string;
  size: number;
  fileCount: number;
}

const readDirectory = async (
  _event: Electron.IpcMainInvokeEvent,
  dirPath: string
): Promise<DirectoryEntry[]> => {
  const entries = await readdir(dirPath, { withFileTypes: true });

  const result: DirectoryEntry[] = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dirPath, entry.name);
      const name = entry.name;
      const isMacApp =
        entry.isDirectory() && name.toLowerCase().endsWith(".app");
      const isDirectory = entry.isDirectory() && !isMacApp;
      const isFile = entry.isFile() || isMacApp;

      let ext = "";
      if (isFile && name.includes(".")) {
        ext = name.split(".").pop()?.toLowerCase() ?? "";
      }

      let size = 0;
      let fileCount = 0;

      if (isFile) {
        try {
          const stat = await lstat(fullPath);
          size = stat.size;
        } catch {
          // Skip files that can't be accessed
        }
      } else if (isDirectory) {
        try {
          const dirEntries = await readdir(fullPath);
          fileCount = dirEntries.length;
        } catch {
          // Skip directories that can't be accessed
        }
      }

      return {
        name,
        path: fullPath,
        isDirectory,
        isFile,
        extension: ext,
        size,
        fileCount,
      };
    })
  );

  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return collator.compare(a.name, b.name);
  });

  return result;
};

registerEvent("readDirectory", readDirectory);
