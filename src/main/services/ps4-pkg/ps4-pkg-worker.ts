import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import { extractPs4Pkg } from "./ps4-pkg-extract";
import { Ps4PkgError } from "./ps4-pkg-info";

const PROGRESS_INTERVAL_MS = 250;

interface Ps4PkgWorkerData {
  pkgPath: string;
  outputDirectory: string;
}

const findExistingPath = (target: string) => {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
};

const hasFreeSpace = (target: string, bytes: number) => {
  const existing = findExistingPath(target);
  if (!existing) return true;
  const stats = fs.statfsSync(existing);
  return Number(stats.bavail) * Number(stats.bsize) >= bytes;
};

const { pkgPath, outputDirectory } = workerData as Ps4PkgWorkerData;
let lastProgressAt = 0;
let checkedSpace = false;

try {
  extractPs4Pkg({
    pkgPath,
    outputDirectory,
    onProgress: ({ writtenBytes, totalBytes }) => {
      if (!checkedSpace) {
        checkedSpace = true;
        if (!hasFreeSpace(outputDirectory, totalBytes)) {
          throw new Ps4PkgError("no_space", "Not enough disk space");
        }
      }

      const now = Date.now();
      if (
        writtenBytes < totalBytes &&
        now - lastProgressAt < PROGRESS_INTERVAL_MS
      ) {
        return;
      }
      lastProgressAt = now;
      parentPort?.postMessage({ type: "progress", writtenBytes, totalBytes });
    },
  });
  parentPort?.postMessage({ type: "done" });
} catch (error) {
  parentPort?.postMessage({
    type: "error",
    code: error instanceof Ps4PkgError ? error.code : null,
    message: error instanceof Error ? error.message : String(error),
  });
}
