import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Game } from "@types";
import { logger } from "./logger";
import { NativeAddon } from "./native-addon";

type PatchedFileSnapshot = {
  content: string;
  mode: number;
};

type SettingsSnapshot = {
  files: Map<string, PatchedFileSnapshot>;
};

const snapshots = new Map<string, SettingsSnapshot>();
const description = "The Last of Us Part I screeninfo.cfg";

const containsLastOfUs = (value?: string | null) =>
  Boolean(value && value.toLowerCase().includes("the last of us"));

const looksLikeLastOfUs = (game: Game) =>
  containsLastOfUs(game.executablePath) || containsLastOfUs(game.title);

const screenInfoRoot = () =>
  path.join(os.homedir(), "Saved Games", "The Last of Us Part I", "users");

const findScreenInfoFiles = async () => {
  const root = screenInfoRoot();
  const files: string[] = [];

  const walk = async (directory: string) => {
    const entries = await fs.promises
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.name.toLowerCase() === "screeninfo.cfg") {
        files.push(entryPath);
      }
    }
  };

  await walk(root);

  return Promise.all(
    files.map(async (filePath) => ({
      filePath,
      modifiedAt: (await fs.promises.stat(filePath)).mtimeMs,
    }))
  ).then((results) =>
    results
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .map((result) => result.filePath)
  );
};

const rewriteKeyValueLines = (
  original: string,
  values: Record<string, string>
) => {
  const lineSeparator = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  const seenKeys = new Set<string>();

  const rewritten = lines.map((line) => {
    const separator = line.indexOf("=");

    if (separator <= 0) {
      return line;
    }

    const key = line.slice(0, separator).trim();
    const value = values[key];

    if (value === undefined) {
      return line;
    }

    seenKeys.add(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seenKeys.has(key)) {
      rewritten.push(`${key}=${value}`);
    }
  }

  return rewritten.join(lineSeparator);
};

const makeWritable = async (filePath: string) => {
  const stat = await fs.promises.stat(filePath);
  await fs.promises.chmod(filePath, stat.mode | 0o200);
  return stat.mode;
};

const makeReadOnly = async (filePath: string) => {
  const stat = await fs.promises.stat(filePath);
  await fs.promises.chmod(filePath, stat.mode & ~0o222);
};

const restoreMode = async (filePath: string, mode: number) => {
  await fs.promises.chmod(filePath, mode);
};

export class LastOfUsPartOneSettings {
  public static shouldPatch(game: Game) {
    return process.platform === "win32" && looksLikeLastOfUs(game);
  }

  private static getDisplaySourceName(display: Electron.Display) {
    return NativeAddon.getDisplaySourceNameByBounds({
      x: Math.round(display.bounds.x),
      y: Math.round(display.bounds.y),
      width: Math.round(display.bounds.width),
      height: Math.round(display.bounds.height),
    });
  }

  public static getMonitorIndex(display: Electron.Display) {
    const sourceName = this.getDisplaySourceName(display);
    const displayNumber = sourceName?.match(/DISPLAY(\d+)/i)?.[1];

    if (displayNumber) {
      return Math.max(0, Number(displayNumber) - 1);
    }

    return display.bounds.x === 0 && display.bounds.y === 0 ? 0 : 1;
  }

  public static async apply(
    gameKey: string,
    game: Game,
    display: Electron.Display
  ) {
    if (!this.shouldPatch(game)) {
      return;
    }

    const screenInfoFiles = await findScreenInfoFiles();

    if (!screenInfoFiles.length) {
      logger.warn(`${description} files were not found`, {
        gameKey,
        root: screenInfoRoot(),
      });
      return;
    }

    await this.restore(gameKey);

    const files = new Map<string, PatchedFileSnapshot>();
    const monitorIndex = this.getMonitorIndex(display);
    const width = Math.round(display.bounds.width);
    const height = Math.round(display.bounds.height);

    for (const filePath of screenInfoFiles) {
      const mode = await makeWritable(filePath);
      const content = await fs.promises.readFile(filePath, "utf8");
      files.set(filePath, { content, mode });

      const patched = rewriteKeyValueLines(content, {
        WindowMode: "1",
        MonitorIndex: String(monitorIndex),
        WindowX: "0",
        WindowY: "0",
        WindowWidth: String(width),
        WindowHeight: String(height),
        BorderlessWidth: String(width),
        BorderlessHeight: String(height),
      });

      await fs.promises.writeFile(filePath, patched, "utf8");
      await makeReadOnly(filePath);
    }

    snapshots.set(gameKey, { files });

    logger.info(`Applied ${description}`, {
      gameKey,
      monitorIndex,
      width,
      height,
      files: screenInfoFiles,
    });
  }

  public static async restore(gameKey: string) {
    const snapshot = snapshots.get(gameKey);

    if (!snapshot) {
      return;
    }

    snapshots.delete(gameKey);

    for (const [filePath, fileSnapshot] of snapshot.files) {
      try {
        if (fs.existsSync(filePath)) {
          await makeWritable(filePath);
          await fs.promises.writeFile(filePath, fileSnapshot.content, "utf8");
          await restoreMode(filePath, fileSnapshot.mode);
        }
      } catch (error) {
        logger.warn(`Failed to restore ${description}`, { filePath, error });
      }
    }
  }
}
