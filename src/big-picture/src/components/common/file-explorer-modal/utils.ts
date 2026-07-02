import { formatBytes } from "@shared";
import type { DirectoryEntry } from "../../../helpers";

export interface FileFilter {
  name: string;
  extensions: string[];
}

const WINDOWS_DRIVE_RE = /^[A-Za-z]:$/;
const WINDOWS_ROOT_RE = /^[A-Za-z]:[\\/]?$/;

export function getParentPath(path: string): string | null {
  if (!path) return null;

  const isWindowsPath = path.includes("\\") || /^[A-Za-z]:([\\/]|$)/.test(path);

  if (isWindowsPath) {
    const trimmedPath = path.replace(/[\\/]+$/, "");

    if (WINDOWS_ROOT_RE.test(path) || WINDOWS_DRIVE_RE.test(trimmedPath)) {
      return null;
    }

    const lastSeparator = Math.max(
      trimmedPath.lastIndexOf("\\"),
      trimmedPath.lastIndexOf("/")
    );

    if (lastSeparator === -1) return null;

    const parent = trimmedPath.slice(0, lastSeparator).replaceAll("/", "\\");
    return WINDOWS_DRIVE_RE.test(parent) ? `${parent}\\` : parent || null;
  }

  const normalized = path.replace(/\/$/, "");

  if (normalized === "/") return null;

  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return null;

  return normalized.substring(0, lastSlash) || "/";
}

export function getEntryMeta(entry: DirectoryEntry): string {
  if (!entry.isFile) return "";
  return formatBytes(entry.size);
}

export function normalizeFilters(filters?: FileFilter[]): Set<string> | null {
  if (!filters || filters.length === 0) return null;

  const allExtensions = filters.flatMap((f) => f.extensions);
  const specificExtensions = allExtensions.filter((ext) => ext !== "*");

  if (specificExtensions.length === 0) return null;

  return new Set(specificExtensions.map((ext) => ext.toLowerCase()));
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
