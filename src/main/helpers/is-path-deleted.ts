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
// An unplugged drive or offline share fails the same way a deleted file does
// so those are not treated as deleted.
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

  // macOS/Linux: the mount point of an unplugged drive is either gone or an
  // empty folder. If the closest folder that still exists is the volume itself
  // (or above it, the drive is missing, not the file.
  const volumeDepth = REMOVABLE_VOLUME_ROOTS.find(
    ([root]) => resolved === root || resolved.startsWith(root + path.sep)
  )?.[1];

  if (volumeDepth === undefined) return true;

  let ancestor = path.dirname(resolved);
  while (!(await exists(ancestor)) && ancestor !== path.dirname(ancestor)) {
    ancestor = path.dirname(ancestor);
  }

  return depthOf(ancestor) > volumeDepth;
};
