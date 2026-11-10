import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

import workerPath from "./ps4-pkg-worker?modulePath";
import {
  Ps4PkgError,
  readPs4PkgInfo,
  type Ps4PkgErrorCode,
  type Ps4PkgInfo,
} from "./ps4-pkg-info";

export interface Ps4PkgInstallOptions {
  pkgPath: string;
  gameDirectory?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface Ps4PkgInstallResult {
  info: Ps4PkgInfo;
  gameDirectory: string;
}

interface WorkerMessage {
  type: "progress" | "done" | "error";
  writtenBytes?: number;
  totalBytes?: number;
  code?: Ps4PkgErrorCode | null;
  message?: string;
}

const hasGameFiles = (directory: string) =>
  fs.existsSync(path.join(directory, "eboot.bin")) &&
  fs.existsSync(path.join(directory, "sce_sys"));

export const isPs4PkgPath = (filePath: string) =>
  path.extname(filePath).toLowerCase() === ".pkg";

const runWorker = (
  pkgPath: string,
  outputDirectory: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Ps4PkgError("cancelled", "Extraction cancelled"));
      return;
    }

    const worker = new Worker(workerPath, {
      workerData: { pkgPath, outputDirectory },
    });
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      void worker.terminate();
      settle(new Ps4PkgError("cancelled", "Extraction cancelled"));
    };
    signal?.addEventListener("abort", onAbort);

    worker.on("message", (message: WorkerMessage) => {
      if (message.type === "progress" && message.totalBytes) {
        onProgress?.((message.writtenBytes ?? 0) / message.totalBytes);
      } else if (message.type === "done") {
        settle();
      } else if (message.type === "error") {
        settle(
          new Ps4PkgError(
            message.code ?? "failed",
            message.message ?? "PKG extraction failed"
          )
        );
      }
    });
    worker.on("error", (error) => settle(error));
    worker.on("exit", (code) => {
      if (code !== 0) {
        settle(new Ps4PkgError("failed", `PKG worker exited with ${code}`));
      } else {
        settle(new Ps4PkgError("failed", "PKG worker stopped early"));
      }
    });
  });

const resolveTarget = (
  info: Ps4PkgInfo,
  pkgPath: string,
  gameDirectory?: string | null
) => {
  const besidePkg = path.join(path.dirname(pkgPath), info.titleId);

  if (info.kind === "game") return besidePkg;

  if (info.kind === "patch") {
    const base = gameDirectory ?? besidePkg;
    if (!hasGameFiles(base)) {
      throw new Ps4PkgError(
        "missing_base_game",
        `No extracted game for update ${info.titleId}`
      );
    }
    return base;
  }

  throw new Ps4PkgError(
    "unsupported_pkg",
    `PKG of kind ${info.kind} is not supported`
  );
};

export const installPs4Pkg = async ({
  pkgPath,
  gameDirectory,
  onProgress,
  signal,
}: Ps4PkgInstallOptions): Promise<Ps4PkgInstallResult> => {
  const info = await readPs4PkgInfo(pkgPath);
  if (info.isDeltaPatch) {
    throw new Ps4PkgError("unsupported_pkg", "Delta updates are not supported");
  }

  const target = resolveTarget(info, pkgPath, gameDirectory);
  const createdTarget = !fs.existsSync(target);

  try {
    await runWorker(pkgPath, target, onProgress, signal);
  } catch (error) {
    if (createdTarget) {
      await fs.promises.rm(target, { recursive: true, force: true });
    }
    throw error;
  }

  await fs.promises.rm(pkgPath, { force: true });
  return { info, gameDirectory: target };
};
