import fs from "node:fs";
import path from "node:path";

import type { KnownBinary } from "./known-binaries";

const readDirectory = (directory: string): fs.Dirent[] | null => {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }
};

const findExecutableInDirectory = (
  directory: string,
  entries: fs.Dirent[],
  executableNames: Set<string>,
  bundleNames: Set<string>,
  pendingDirectories: string[]
): string | null => {
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const normalizedName = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      if (bundleNames.has(normalizedName)) return fullPath;
      pendingDirectories.push(fullPath);
    } else if (entry.isFile() && executableNames.has(normalizedName)) {
      return fullPath;
    }
  }
  return null;
};

export const findManagedEmulatorExecutable = (
  root: string,
  binary: KnownBinary
): string | null => {
  const executableNames = new Set(
    [...binary.linuxNames, ...binary.windowsNames].map((name) =>
      name.toLowerCase()
    )
  );
  const bundleNames = new Set(
    binary.macosBundleNames.map((name) => name.toLowerCase())
  );
  const stack = [root];

  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) continue;

    const entries = readDirectory(directory);
    if (!entries) continue;

    const executable = findExecutableInDirectory(
      directory,
      entries,
      executableNames,
      bundleNames,
      stack
    );
    if (executable) return executable;
  }

  return null;
};

export const requireManagedEmulatorExecutable = (
  root: string,
  binary: KnownBinary
): string => {
  const executable = findManagedEmulatorExecutable(root, binary);
  if (!executable) {
    throw new Error(`No ${binary.displayName} executable found in archive`);
  }
  return executable;
};
