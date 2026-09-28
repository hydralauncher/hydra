import fs from "node:fs";
import path from "node:path";

import { isWithin } from "../emulators/rom-path-utils.js";

const MISSING_PATH_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);

const isMissingPathError = (err: NodeJS.ErrnoException) =>
  MISSING_PATH_ERROR_CODES.has(err.code ?? "");

// A drive that went offline takes its folders with it or leaves an empty mount point behind
const closestFolderHasEntries = async (
  filePath: string,
  root: string
): Promise<boolean> => {
  const folder = path.dirname(filePath);

  if (folder === filePath || !isWithin(folder, root)) return false;

  return fs.promises.readdir(folder).then(
    (entries) => entries.length > 0,
    (err: NodeJS.ErrnoException) =>
      isMissingPathError(err) && closestFolderHasEntries(folder, root)
  );
};

export const isExecutableMissing = async (
  executablePath: string,
  scannedDirectories: string[]
) => {
  const directory = scannedDirectories.find((scannedDirectory) =>
    isWithin(executablePath, scannedDirectory)
  );

  if (!directory) return false;

  return fs.promises.access(executablePath).then(
    () => false,
    (err: NodeJS.ErrnoException) =>
      isMissingPathError(err) &&
      closestFolderHasEntries(executablePath, directory)
  );
};
