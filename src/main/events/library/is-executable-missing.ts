import fs from "node:fs";
import path from "node:path";

import { isWithin } from "../emulators/rom-path-utils.js";

const MISSING_PATH_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);

const isMissingPathError = (err: unknown) =>
  MISSING_PATH_ERROR_CODES.has((err as NodeJS.ErrnoException).code ?? "");

const isEntryGone = async (entryPath: string) => {
  try {
    await fs.promises.lstat(entryPath);
    return false;
  } catch (err) {
    return isMissingPathError(err);
  }
};

// Storage that went offline takes its folders with it, leaves an empty mount
// point behind, or leaves a mount point or link that can no longer be opened
const isClosestFolderAvailable = async (
  missingPath: string,
  root: string
): Promise<boolean> => {
  const folder = path.dirname(missingPath);

  if (
    folder === missingPath ||
    !isWithin(folder, root) ||
    !(await isEntryGone(missingPath))
  ) {
    return false;
  }

  try {
    const entries = await fs.promises.readdir(folder);
    return entries.length > 0;
  } catch (err) {
    return isMissingPathError(err) && isClosestFolderAvailable(folder, root);
  }
};

export const isExecutableMissing = async (
  executablePath: string,
  scannedDirectories: string[]
) => {
  const directory = scannedDirectories.find((scannedDirectory) =>
    isWithin(executablePath, scannedDirectory)
  );

  if (!directory) return false;

  try {
    await fs.promises.access(executablePath);
    return false;
  } catch (err) {
    return (
      isMissingPathError(err) &&
      isClosestFolderAvailable(executablePath, directory)
    );
  }
};
