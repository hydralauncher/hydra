import fs from "node:fs";
import path from "node:path";

// Where unplugged drives live on macOS/Linux, and how many path segments the
// volume itself takes (e.g. /media/<user>/<label> is 3).
const REMOVABLE_VOLUME_ROOTS: Array<[root: string, depth: number]> = [
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

  const volumeDepth = REMOVABLE_VOLUME_ROOTS.find(
    ([root]) => resolved === root || resolved.startsWith(root + path.sep)
  )?.[1];

  // If it's not in a recognized removable volume path, treat as deleted.
  if (volumeDepth === undefined) return true;

  let ancestor = path.dirname(resolved);
  while (!(await exists(ancestor)) && ancestor !== path.dirname(ancestor)) {
    ancestor = path.dirname(ancestor);
  }

  const ancestorDepth = depthOf(ancestor);

  if (ancestorDepth > volumeDepth) {
    // The closest existing parent is a folder inside the volume. File is deleted.
    return true;
  }

  if (ancestorDepth === volumeDepth) {
    // The closest existing parent IS the volume root (e.g., /mnt/disk).
    // Check if the volume root is empty. An empty directory means the drive is offline.
    try {
      const entries = await fs.promises.readdir(ancestor);
      if (entries.length === 0) {
        return false; // Drive is offline/unmounted, do not treat file as deleted.
      }
    } catch {
      return false; // Cannot read directory, assume offline.
    }
    return true; // Volume has files, so the file was truly deleted.
  }

  return false;
};
