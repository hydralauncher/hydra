import fs from "node:fs";
import path from "node:path";

// Where unplugged drives live on macOS/Linux, and how many path segments the
// volume itself takes (e.g. /media/<user>/<label> is 3).
export const REMOVABLE_VOLUME_ROOTS: Array<[root: string, depth: number]> = [
  ["/Volumes", 2],
  ["/mnt", 2],
  ["/media", 3],
  ["/run/media", 4],
];

const exists = (target: string) =>
  fs.promises.access(target).then(
    () => true,
    () => false
  );

const depthOf = (target: string) =>
  target.split(path.sep).filter(Boolean).length;

// Helper to check if a directory is empty. We use this so it can be mocked in tests.
export const isDirectoryEmpty = async (dirPath: string): Promise<boolean> => {
  try {
    const entries = await fs.promises.readdir(dirPath);
    return entries.length === 0;
  } catch {
    return true; // Assume empty/offline if we can't read it
  }
};

// Walks up from target until it finds a directory that exists.
const findExistingAncestor = async (target: string): Promise<string> => {
  let ancestor = path.dirname(target);
  while (!(await exists(ancestor)) && ancestor !== path.dirname(ancestor)) {
    ancestor = path.dirname(ancestor);
  }
  return ancestor;
};

// True only when target is gone while the drive it lived on is still there.
export const isPathDeleted = async (target: string): Promise<boolean> => {
  try {
    await fs.promises.access(target);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") return false;
  }

  const resolved = path.resolve(target);

  // Windows: an offline drive or share has no reachable root (E:\, \\server\share\).
  if (!(await exists(path.parse(resolved).root))) return false;

  const parent = path.dirname(resolved);
  const ancestor = await findExistingAncestor(resolved);

  const volumeDepth = REMOVABLE_VOLUME_ROOTS.find(
    ([root]) => resolved === root || resolved.startsWith(root + path.sep)
  )?.[1];

  if (volumeDepth === undefined) {
    // Not a recognized removable volume. If the parent folder still exists,
    // the file itself was removed.
    if (ancestor === parent) return true;

    // The parent is missing. If the nearest existing ancestor is an empty
    // folder, it is most likely an unmounted mount point, so treat the path
    // as offline rather than deleted. A non-empty ancestor means the
    // containing folder was deleted while its siblings remain.
    return !(await isDirectoryEmpty(ancestor));
  }

  const ancestorDepth = depthOf(ancestor);

  if (ancestorDepth > volumeDepth) {
    // The closest existing parent is a folder inside the volume. File is deleted.
    return true;
  }

  if (ancestorDepth === volumeDepth) {
    // The closest existing parent IS the volume root (e.g., /mnt/disk).
    // Check if the volume root is empty. An empty directory means the drive is offline.
    const isEmpty = await isDirectoryEmpty(ancestor);
    if (isEmpty) {
      return false; // Drive is offline/unmounted, do not treat file as deleted.
    }
    return true; // Volume has files, so the file was truly deleted.
  }

  return false;
};