import type { DirectoryEntry } from "../../../helpers";
import { formatBytes } from "@shared";

export interface FileFilter {
  name: string;
  extensions: string[];
}

const WINDOWS_DRIVE_RE = /^[A-Za-z]:$/;

export function getParentPath(path: string): string | null {
  if (!path) return null;

  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");

  if (normalized === "/") return null;
  if (WINDOWS_DRIVE_RE.test(normalized)) return null;

  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return null;

  const parent = normalized.substring(0, lastSlash) || "/";

  return WINDOWS_DRIVE_RE.test(parent) ? parent + "/" : parent;
}

export function getEntryMeta(entry: DirectoryEntry): string {
  if (!entry.isFile) return "";
  return formatBytes(entry.size);
}

export function normalizeFilters(filters?: FileFilter[]): Set<string> | null {
  if (!filters || filters.length === 0) return null;

  const allExtensions = filters.flatMap((f) => f.extensions);
  if (allExtensions.includes("*")) return null;

  return new Set(allExtensions.map((ext) => ext.toLowerCase()));
}

export function matchesFilters(
  entry: DirectoryEntry,
  allowedExtensions: Set<string> | null,
  directoryOnly: boolean
): boolean {
  if (directoryOnly && !entry.isDirectory) return false;
  if (entry.isDirectory) return true;
  if (!allowedExtensions) return true;

  return allowedExtensions.has(entry.extension);
}
