import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

const MACOS_APP_EXTENSION = ".app";

const canExecute = (targetPath: string): boolean => {
  try {
    accessSync(targetPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const isMacAppBundlePath = (targetPath: string): boolean =>
  process.platform === "darwin" &&
  path.extname(path.normalize(targetPath)).toLowerCase() ===
    MACOS_APP_EXTENSION;

export const findMacAppBundleRoot = (targetPath: string): string | null => {
  if (process.platform !== "darwin" || !targetPath) return null;

  const normalizedPath = path.normalize(targetPath);
  const parts = normalizedPath.split(path.sep);
  const appIndex = parts.findIndex((part) =>
    part.toLowerCase().endsWith(MACOS_APP_EXTENSION)
  );

  if (appIndex === -1) return null;

  const root = parts.slice(0, appIndex + 1).join(path.sep) || path.sep;
  if (!existsSync(root)) return null;

  try {
    if (!statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }

  return root;
};

const readBundleExecutableName = (appBundlePath: string): string | null => {
  const infoPlistPath = path.join(appBundlePath, "Contents", "Info.plist");
  if (!existsSync(infoPlistPath)) return null;

  const result = spawnSync(
    "plutil",
    ["-extract", "CFBundleExecutable", "raw", infoPlistPath],
    {
      encoding: "utf8",
      shell: false,
      timeout: 3000,
    }
  );

  if (result.error || result.status !== 0) return null;

  const executableName = result.stdout.trim();
  return executableName.length > 0 ? executableName : null;
};

const findFallbackBundleExecutable = (
  contentsMacOsPath: string
): string | null => {
  let entries: string[];

  try {
    entries = readdirSync(contentsMacOsPath);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const candidate = path.join(contentsMacOsPath, entry);

    try {
      if (statSync(candidate).isFile() && canExecute(candidate)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
};

export const resolveMacAppBundleExecutable = (
  targetPath: string
): string | null => {
  const appBundlePath = findMacAppBundleRoot(targetPath);
  if (!appBundlePath) return null;

  const contentsMacOsPath = path.join(appBundlePath, "Contents", "MacOS");
  const bundleExecutableName = readBundleExecutableName(appBundlePath);

  if (bundleExecutableName) {
    const candidate = path.join(contentsMacOsPath, bundleExecutableName);

    try {
      if (statSync(candidate).isFile() && canExecute(candidate)) {
        return candidate;
      }
    } catch {
      return null;
    }
  }

  return findFallbackBundleExecutable(contentsMacOsPath);
};

export const resolveEmulatorExecutableTarget = (
  executablePath: string
): string | null => {
  if (!executablePath) return null;

  const normalizedPath = path.normalize(executablePath);
  const appBundlePath = findMacAppBundleRoot(normalizedPath);

  if (appBundlePath) {
    return resolveMacAppBundleExecutable(appBundlePath);
  }

  return normalizedPath;
};
