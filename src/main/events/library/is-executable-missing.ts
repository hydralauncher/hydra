import fs from "node:fs";
import path from "node:path";

import { isWithin } from "../emulators/rom-path-utils.js";

const MISSING_PATH_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);

const isMissingPathError = (err: unknown) =>
  MISSING_PATH_ERROR_CODES.has((err as NodeJS.ErrnoException).code ?? "");

// A drive that went offline takes its folders with it, and outside Windows an
// unmounted drive can leave an empty mount point behind
const isClosestFolderAvailable = async (
  filePath: string,
  root: string
): Promise<boolean> => {
  const folder = path.dirname(filePath);

  if (folder === filePath || !isWithin(folder, root)) return false;

  try {
    const entries = await fs.promises.readdir(folder);
    return entries.length > 0 || process.platform === "win32";
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
