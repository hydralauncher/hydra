import fs from "node:fs";
import path from "node:path";

const POSIX_MOUNT_CONTAINERS = [
  /^\/$/,
  /^\/(?:media|mnt|Volumes)$/,
  /^\/run\/media$/,
  /^\/(?:run\/)?media\/[^/]+$/,
];

const pathExists = (filePath: string) =>
  fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);

const findNearestExistingAncestor = async (
  filePath: string,
  paths: typeof path.posix
) => {
  let current = paths.dirname(filePath);

  while (!(await pathExists(current))) {
    const parent = paths.dirname(current);
    if (parent === current) return null;
    current = parent;
  }

  return current;
};

export const isExecutableMissingFromAvailableStorage = async (
  executablePath: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> => {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (!paths.isAbsolute(executablePath)) return false;
  if (await pathExists(executablePath)) return false;

  if (platform === "win32") {
    return pathExists(paths.parse(executablePath).root);
  }

  const ancestor = await findNearestExistingAncestor(executablePath, paths);
  if (!ancestor) return false;

  return !POSIX_MOUNT_CONTAINERS.some((pattern) => pattern.test(ancestor));
};
