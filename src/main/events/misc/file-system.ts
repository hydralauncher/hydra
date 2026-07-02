import { app } from "electron";
import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";
import { registerEvent } from "../register-event";

const FILE_STAT_CONCURRENCY = 32;

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  extension: string;
  size: number;
}

interface PathInfo {
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
}

function getReleaseRendererOrigin(): string | null {
  const subdomain = import.meta.env.MAIN_VITE_LAUNCHER_SUBDOMAIN;
  if (!subdomain) return null;

  try {
    return new URL(
      `https://release-v${app.getVersion().replaceAll(".", "-")}.${subdomain}`
    ).origin;
  } catch {
    return null;
  }
}

function getDevRendererOrigin(): string | null {
  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!rendererUrl) return null;

  try {
    return new URL(rendererUrl).origin;
  } catch {
    return null;
  }
}

function isTrustedRendererUrl(url: string): boolean {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  if (parsedUrl.protocol === "app:" || parsedUrl.protocol === "file:") {
    return true;
  }

  const trustedOrigins = [
    getDevRendererOrigin(),
    getReleaseRendererOrigin(),
  ].filter((origin): origin is string => Boolean(origin));

  return trustedOrigins.includes(parsedUrl.origin);
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!event.senderFrame) {
    throw new Error("Unauthorized IPC sender");
  }

  const url = event.senderFrame.url;
  if (!isTrustedRendererUrl(url)) {
    throw new Error("Unauthorized IPC sender");
  }
}

async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  limit: number,
  mapper: (item: TItem) => Promise<TResult>
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const nextIndex = currentIndex;
      currentIndex += 1;
      results[nextIndex] = await mapper(items[nextIndex]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

const readDirectory = async (
  event: Electron.IpcMainInvokeEvent,
  dirPath: string
): Promise<DirectoryEntry[]> => {
  assertTrustedSender(event);

  const entries = await readdir(dirPath, { withFileTypes: true });

  const result = await mapWithConcurrency(
    entries,
    FILE_STAT_CONCURRENCY,
    async (entry): Promise<DirectoryEntry> => {
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
    }
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
  event: Electron.IpcMainInvokeEvent,
  filePath: string
): Promise<PathInfo> => {
  assertTrustedSender(event);

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
