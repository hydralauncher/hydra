import fs from "node:fs";
import path from "node:path";

import type { KnownBinary } from "./known-binaries";

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

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const normalizedName = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        if (bundleNames.has(normalizedName)) return fullPath;
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && executableNames.has(normalizedName)) {
        return fullPath;
      }
    }
  }

  return null;
};
