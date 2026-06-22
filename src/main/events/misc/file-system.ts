import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";
import { registerEvent } from "../register-event";

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  extension: string;
  size: number;
}

export interface PathInfo {
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
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

      if (isFile) {
        try {
          const stats = await stat(fullPath);
          size = stats.size;
        } catch {
          // File may not be accessible
        }
      }

      return {
        name,
        path: fullPath,
        isDirectory,
        isFile,
        extension: ext,
        size,
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

const getPathInfo = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
): Promise<PathInfo> => {
  try {
    const stats = await stat(filePath);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  } catch {
    return {
      exists: false,
      isDirectory: false,
      isFile: false,
    };
  }
};

const listDrives = async (): Promise<string[]> => {
  if (platform() === "win32") {
    const drives: string[] = [];

    for (let i = 0; i < 26; i++) {
      const letter = String.fromCodePoint(65 + i);
      const root = `${letter}:\\`;

      try {
        await access(root);
        drives.push(root);
      } catch {
        // Drive doesn't exist
      }
    }

    return drives;
  }

  return ["/"];
};

registerEvent("readDirectory", readDirectory);
registerEvent("getPathInfo", getPathInfo);
registerEvent("listDrives", listDrives);
