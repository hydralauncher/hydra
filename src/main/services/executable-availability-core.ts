import fs from "node:fs";
import path from "node:path";

const POSIX_MOUNT_CONTAINERS = [
  /^\/$/,
  /^\/(?:media|mnt|Volumes)$/,
  /^\/run\/media$/,
  /^\/(?:run\/)?media\/[^/]+$/,
];

const POSIX_MOUNT_POINT_PATTERNS = [
  /^\/(?:mnt|Volumes)\/[^/]+$/,
  /^\/media\/[^/]+(?:\/[^/]+)?$/,
  /^\/run\/media\/[^/]+\/[^/]+$/,
];

export const parseFstabMountPoints = (content: string) =>
  new Set(
    content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/\s+/)[1])
      .filter(Boolean)
      .map((mountPoint) => mountPoint.replaceAll(String.raw`\040`, " "))
  );

export const isMountPointCandidate = (
  directory: string,
  fstabMountPoints: Set<string>
) =>
  fstabMountPoints.has(directory) ||
  POSIX_MOUNT_POINT_PATTERNS.some((pattern) => pattern.test(directory));

const readFstabMountPoints = () =>
  fs.promises
    .readFile("/etc/fstab", "utf8")
    .then(parseFstabMountPoints)
    .catch(() => new Set<string>());

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

const isEmptyDirectory = (directory: string) =>
  fs.promises
    .readdir(directory)
    .then((entries) => entries.length === 0)
    .catch(() => false);

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
  if (POSIX_MOUNT_CONTAINERS.some((pattern) => pattern.test(ancestor))) {
    return false;
  }

  if (!(await isEmptyDirectory(ancestor))) return true;

  return !isMountPointCandidate(ancestor, await readFstabMountPoints());
};
