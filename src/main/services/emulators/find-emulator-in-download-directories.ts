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

const findInImmediateSubdirectories = (
  directory: string,
  names: string[]
): string | null => {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const executable = findDirect(path.join(directory, entry.name), names);
    if (executable) return executable;
  }

  return null;
};

const findAppImageInImmediateSubdirectories = (
  directory: string,
  binary: DownloadDetectableBinary
): string | null => {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const appImage = findAppImage(path.join(directory, entry.name), binary);
    if (appImage) return appImage;
  }
  return null;
};

const findInNamedEmulatorDirectories = (
  downloadDirectory: string,
  binary: DownloadDetectableBinary
): string | null => {
  const emulatorDirectories = new Set([
    path.join(downloadDirectory, binary.displayName),
    path.join(downloadDirectory, binary.binary),
  ]);

  for (const emulatorDirectory of emulatorDirectories) {
    const managed = findManagedEmulatorExecutable(emulatorDirectory, binary);
    if (managed) return managed;

    if (process.platform === "linux") {
      const directAppImage = findAppImage(emulatorDirectory, binary);
      if (directAppImage) return directAppImage;

      const nestedAppImage = findAppImageInImmediateSubdirectories(
        emulatorDirectory,
        binary
      );
      if (nestedAppImage) return nestedAppImage;
    }
  }
  return null;
};

const findInDownloadDirectory = (
  downloadDirectory: string,
  binary: DownloadDetectableBinary,
  executableNames: string[]
): string | null => {
  const direct = findDirect(downloadDirectory, [
    ...executableNames,
    ...binary.macosBundleNames,
  ]);
  if (direct) return direct;

  const managed = findInNamedEmulatorDirectories(downloadDirectory, binary);
  if (managed) return managed;

  const portable = findInImmediateSubdirectories(downloadDirectory, [
    ...executableNames,
    ...binary.macosBundleNames,
  ]);
  if (portable) return portable;

  return process.platform === "linux"
    ? findAppImage(downloadDirectory, binary)
    : null;
};

export const findEmulatorInDownloadDirectories = (
  binary: DownloadDetectableBinary,
  downloadDirectories: string[]
): string | null => {
  const executableNames =
    process.platform === "win32" ? binary.windowsNames : binary.linuxNames;

  for (const downloadDirectory of downloadDirectories) {
    const executable = findInDownloadDirectory(
      downloadDirectory,
      binary,
      executableNames
    );
    if (executable) return executable;
  }

  return null;
};
