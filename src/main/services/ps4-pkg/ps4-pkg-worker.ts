import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

import { createRequire } from "node:module";

import {
  setNativeSectorDecryptor,
  type NativeSectorDecryptor,
  type Ps4PkgKeys,
} from "./ps4-pkg-crypto";
import { extractPs4Pkg, type Ps4PkgExtractShard } from "./ps4-pkg-extract";
import { Ps4PkgError } from "./ps4-pkg-info";

const PROGRESS_INTERVAL_MS = 250;

interface Ps4PkgWorkerData {
  pkgPath: string;
  outputDirectory: string;
  shard: Ps4PkgExtractShard;
  nativeAddonPath: string | null;
  keys: Ps4PkgKeys;
  stopFlag: SharedArrayBuffer;
}

/** Decrypting natively is what makes the extraction run at disk speed. */
const loadNativeDecryptor = (addonPath: string | null) => {
  if (!addonPath) return;
  try {
    const addon = createRequire(import.meta.url)(addonPath) as {
      decryptPs4PkgSectors?: NativeSectorDecryptor;
    };
    if (addon.decryptPs4PkgSectors) {
      setNativeSectorDecryptor(addon.decryptPs4PkgSectors);
    }
  } catch {
    // An older addon without the function: the JavaScript fallback runs.
  }
};

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

const { pkgPath, outputDirectory, shard, nativeAddonPath, keys, stopFlag } =
  workerData as Ps4PkgWorkerData;
loadNativeDecryptor(nativeAddonPath);
const stop = new Int32Array(stopFlag);
let lastProgressAt = 0;
let checkedSpace = false;

try {
  extractPs4Pkg({
    pkgPath,
    outputDirectory,
    shard,
    keys,
    onProgress: ({ writtenBytes, totalBytes, pkgBytes }) => {
      if (Atomics.load(stop, 0) === 1) {
        throw new Ps4PkgError("cancelled", "Extraction cancelled");
      }
      if (!checkedSpace) {
        checkedSpace = true;
        // Only the first worker checks, against the whole PKG.
        if (shard.index === 0 && !hasFreeSpace(outputDirectory, pkgBytes)) {
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
      parentPort?.postMessage({
        type: "progress",
        writtenBytes,
        totalBytes,
        pkgBytes,
      });
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
