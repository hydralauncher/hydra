import fs from "node:fs";
import path from "node:path";

import { SystemPath } from "@main/services/system-path";

export const WINDOWS_GAME_DIRECTORIES = [
  String.raw`C:\Games`,
  String.raw`D:\Games`,
];

const WINDOWS_DRIVE_GAME_FOLDERS = ["Games", "GOG Games"];

const WINE_DRIVE_C_GAME_FOLDERS = [
  "Games",
  "GOG Games",
  "Program Files",
  "Program Files (x86)",
];

const MODIFICATION_TIME_TOLERANCE_MS = 2000;
const MAX_CHANGED_FOLDERS = 10;

const SKIPPED_FOLDERS = new Set([
  "steam",
  "steamlibrary",
  "steamapps",
  "epic games",
  "gog galaxy",
  "ubisoft",
  "ubisoft game launcher",
  "ea games",
  "ea app",
  "electronic arts",
  "origin",
  "origin games",
  "battle.net",
  "riot games",
  "rockstar games",
  "xboxgames",
  "windowsapps",
  "hydra",
  "common files",
  "internet explorer",
  "windows media player",
  "windows nt",
  "windowspowershell",
  "microsoft.net",
  "msbuild",
  "reference assemblies",
]);

const getChangedAt = (stats: fs.Stats) =>
  Math.max(stats.birthtimeMs, stats.mtimeMs);

const unique = (values: (string | null | undefined)[]) => [
  ...new Set(values.filter((value): value is string => !!value)),
];

const getWindowsTargetDirectories = (downloadPath: string) => {
  const drives = unique([
    "C:",
    "D:",
    process.env.SystemDrive,
    path.win32.parse(downloadPath).root.replace(/\\$/, ""),
  ]).map((drive) => drive.toUpperCase());

  return unique([
    ...WINDOWS_GAME_DIRECTORIES,
    ...drives.flatMap((drive) =>
      WINDOWS_DRIVE_GAME_FOLDERS.map((folder) =>
        path.win32.join(`${drive}\\`, folder)
      )
    ),
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ]);
};

const getWinePrefixTargetDirectories = (winePrefixPath: string | null) => {
  const prefixes = unique([
    winePrefixPath,
    process.env.WINEPREFIX ?? path.join(SystemPath.getPath("home"), ".wine"),
  ]);

  return prefixes.flatMap((prefix) =>
    WINE_DRIVE_C_GAME_FOLDERS.map((folder) =>
      path.join(prefix, "drive_c", folder)
    )
  );
};

export const getInstallerTargetDirectories = (
  downloadPath: string,
  winePrefixPath: string | null
) => {
  if (process.platform === "win32") {
    return getWindowsTargetDirectories(downloadPath);
  }

  if (process.platform === "linux") {
    return getWinePrefixTargetDirectories(winePrefixPath);
  }

  return [];
};

const listSubfoldersChangedSince = async (directory: string, since: number) => {
  const entries = await fs.promises
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);

  const subfolders = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() && !SKIPPED_FOLDERS.has(entry.name.toLowerCase())
      )
      .map(async (entry) => {
        const folderPath = path.join(directory, entry.name);
        const stats = await fs.promises.stat(folderPath).catch(() => null);
        const changedAt = stats ? getChangedAt(stats) : 0;

        return { folderPath, changedAt };
      })
  );

  return subfolders.filter(({ changedAt }) => changedAt >= since);
};

export const listFoldersChangedSince = async (
  directories: string[],
  since: number
) => {
  const threshold = since - MODIFICATION_TIME_TOLERANCE_MS;

  const changed = (
    await Promise.all(
      directories.map((directory) =>
        listSubfoldersChangedSince(directory, threshold)
      )
    )
  ).flat();

  return unique(
    changed
      .sort((a, b) => b.changedAt - a.changedAt)
      .map(({ folderPath }) => folderPath)
  ).slice(0, MAX_CHANGED_FOLDERS);
};
