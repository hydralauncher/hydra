import fs from "node:fs";
import path from "node:path";

const exists = (target: string) =>
  fs.promises.access(target).then(
    () => true,
    () => false
  );

// True only when the file is gone while its own folder is still there.
// A missing folder is treated as "unknown" (offline drive, unplugged disk,
// network share, or a drive letter that now points to another volume),
// so the stored path is kept.
export const isPathDeleted = async (target: string): Promise<boolean> => {
  try {
    await fs.promises.access(target);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") return false;
  }

  const folder = path.dirname(path.resolve(target));
  return exists(folder);
};
