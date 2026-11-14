import { promises as fs } from "node:fs";
import path from "node:path";

export const isSafeEmulatorRestoreTarget = async (
  root: string,
  segments: string[]
) => {
  const target = path.resolve(root, ...segments);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) return false;
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fs
      .lstat(current)
      .catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? null : undefined
      );
    if (stat === undefined || stat?.isSymbolicLink()) return false;
  }
  return true;
};
