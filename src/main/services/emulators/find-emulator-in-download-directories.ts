import { existsSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";

import { findManagedEmulatorExecutable } from "./find-managed-emulator-executable.js";

interface DownloadDetectableBinary {
  binary: string;
  displayName: string;
  linuxNames: string[];
  windowsNames: string[];
  macosBundleNames: string[];
}

const MAX_SEARCH_DEPTH = 4;
const MAX_SEARCHED_DIRECTORIES = 2_000;

interface PendingDirectory {
  directory: string;
  depth: number;
}

const findDirect = (directory: string, names: string[]): string | null => {
  for (const name of names) {
    const candidate = path.join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const findAppImage = (
  directory: string,
  binary: DownloadDetectableBinary
): string | null => {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return null;
  }

  const keywords = [binary.binary, binary.displayName].map((keyword) =>
    keyword.toLowerCase()
  );
  const appImage = entries.find((entry) => {
    const lower = entry.toLowerCase();
    return (
      lower.endsWith(".appimage") &&
      keywords.some((keyword) => lower.includes(keyword))
    );
  });

  return appImage ? path.join(directory, appImage) : null;
};

const findExecutableInDirectory = (
  directory: string,
  names: string[],
  binary: DownloadDetectableBinary,
  platform: NodeJS.Platform
): string | null => {
  const executable = findDirect(directory, names);
  if (executable || platform !== "linux") return executable;
  return findAppImage(directory, binary);
};

const getChildDirectories = (current: PendingDirectory): PendingDirectory[] => {
  if (current.depth >= MAX_SEARCH_DEPTH) return [];

  let entries: Dirent[];
  try {
    entries = readdirSync(current.directory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      directory: path.join(current.directory, entry.name),
      depth: current.depth + 1,
    }));
};

const findInNestedDirectories = (
  directory: string,
  names: string[],
  binary: DownloadDetectableBinary,
  platform: NodeJS.Platform
): string | null => {
  const pending: PendingDirectory[] = [{ directory, depth: 0 }];
  let searchedDirectories = 0;

  for (const current of pending) {
    if (searchedDirectories >= MAX_SEARCHED_DIRECTORIES) break;
    searchedDirectories += 1;

    const executable = findExecutableInDirectory(
      current.directory,
      names,
      binary,
      platform
    );
    if (executable) return executable;
    pending.push(...getChildDirectories(current));
  }

  return null;
};

const findInNamedEmulatorDirectories = (
  downloadDirectory: string,
  binary: DownloadDetectableBinary,
  platform: NodeJS.Platform
): string | null => {
  const emulatorDirectories = new Set([
    path.join(downloadDirectory, binary.displayName),
    path.join(downloadDirectory, binary.binary),
  ]);

  for (const emulatorDirectory of emulatorDirectories) {
    const managed = findManagedEmulatorExecutable(emulatorDirectory, binary);
    if (managed) return managed;

    if (platform === "linux") {
      const nestedAppImage = findInNestedDirectories(
        emulatorDirectory,
        [],
        binary,
        platform
      );
      if (nestedAppImage) return nestedAppImage;
    }
  }
  return null;
};

const findInDownloadDirectory = (
  downloadDirectory: string,
  binary: DownloadDetectableBinary,
  executableNames: string[],
  platform: NodeJS.Platform
): string | null => {
  const direct = findDirect(downloadDirectory, [
    ...executableNames,
    ...binary.macosBundleNames,
  ]);
  if (direct) return direct;

  const managed = findInNamedEmulatorDirectories(
    downloadDirectory,
    binary,
    platform
  );
  if (managed) return managed;

  const portable = findInNestedDirectories(
    downloadDirectory,
    [...executableNames, ...binary.macosBundleNames],
    binary,
    platform
  );
  if (portable) return portable;
  return null;
};

export const findEmulatorInDownloadDirectories = (
  binary: DownloadDetectableBinary,
  downloadDirectories: string[],
  platform: NodeJS.Platform = process.platform
): string | null => {
  const executableNames =
    platform === "win32" ? binary.windowsNames : binary.linuxNames;

  for (const downloadDirectory of downloadDirectories) {
    const executable = findInDownloadDirectory(
      downloadDirectory,
      binary,
      executableNames,
      platform
    );
    if (executable) return executable;
  }

  return null;
};
