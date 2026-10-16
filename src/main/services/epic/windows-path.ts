import fs from "node:fs/promises";
import path from "node:path";
import { EpicManagedError } from "./legendary-managed-runtime.js";

const contained = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

export function selectWindowsPathSegment(entries: string[], segment: string) {
  if (entries.includes(segment)) return segment;
  const matches = entries.filter(
    (entry) => entry.toLowerCase() === segment.toLowerCase()
  );
  if (matches.length > 1) throw new EpicManagedError("invalid-path");
  return matches[0] ?? null;
}

/** Resolve Windows manifest references, keeping Linux paths and containment exact. */
export async function resolveEpicWindowsPath(root: string, reference: string) {
  if (reference.includes("\0") || /^[a-z]:|^[/\\]{2}/i.test(reference))
    throw new EpicManagedError("invalid-path");
  const relative = reference.replaceAll("\\", "/").replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (!contained(root, candidate)) throw new EpicManagedError("invalid-path");
  let current = root;
  for (const segment of path
    .relative(root, candidate)
    .split(path.sep)
    .filter(Boolean)) {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? ""
        )
      )
        return null;
      throw error;
    }
    const selected = selectWindowsPathSegment(entries, segment);
    if (!selected) return null;
    current = await fs.realpath(path.join(current, selected));
    if (!contained(root, current)) throw new EpicManagedError("invalid-path");
  }
  return current;
}
