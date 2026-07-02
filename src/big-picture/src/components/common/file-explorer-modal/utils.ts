import { formatBytes } from "@shared";
import type { DirectoryEntry } from "../../../helpers";

export interface FileFilter {
  name: string;
  extensions: string[];
}

interface EffectiveFilters {
  allowAll: boolean;
  extensions: Set<string>;
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

export function normalizeFilters(
  filters?: FileFilter[]
): EffectiveFilters | null {
  if (!filters || filters.length === 0) return null;

  const normalizedExtensions = Array.from(
    new Set(
      filters.flatMap((filter) =>
        filter.extensions
          .map((extension) => extension.trim().toLowerCase())
          .filter(Boolean)
      )
    )
  );

  const specificExtensions = normalizedExtensions.filter(
    (extension) => extension !== "*"
  );

  if (specificExtensions.length > 0) {
    return {
      allowAll: false,
      extensions: new Set(specificExtensions),
    };
  }

  if (normalizedExtensions.includes("*")) {
    return {
      allowAll: true,
      extensions: new Set<string>(),
    };
  }

  return null;
}

export function matchesFilters(
  entry: DirectoryEntry,
  filters: EffectiveFilters | null,
  directoryOnly: boolean
): boolean {
  if (directoryOnly && !entry.isDirectory) return false;
  if (entry.isDirectory) return true;
  if (!filters) return true;
  if (filters.allowAll) return true;

  return filters.extensions.has(entry.extension);
}
