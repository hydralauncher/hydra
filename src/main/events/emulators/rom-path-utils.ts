import path from "node:path";

export const normalizePath = (p: string): string => {
  const normalized = path.normalize(p);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

export const isWithin = (child: string, parent: string): boolean => {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  if (c === p) return true;
  const rel = path.relative(p, c);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
};
