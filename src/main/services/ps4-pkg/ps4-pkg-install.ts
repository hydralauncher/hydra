import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

import workerPath from "./ps4-pkg-worker?modulePath";
import { parseParamSfoValue } from "../emulators/param-sfo.js";
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
  /** Only for PKGs Hydra downloaded; a PKG the user picked is kept. */
  deletePkg?: boolean;
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

const PARAM_SFO = path.join("sce_sys", "param.sfo");

const hasGameFiles = (directory: string) =>
  fs.existsSync(path.join(directory, "eboot.bin")) &&
  fs.existsSync(path.join(directory, "sce_sys"));

export const isPs4PkgPath = (filePath: string) =>
  path.extname(filePath).toLowerCase() === ".pkg";

/** "01.09" and "0109" both read as 109. */
const toVersionNumber = (version: string | null | undefined) => {
  const digits = version?.replace(/\D/g, "");
  return digits ? Number(digits) : null;
};

export const readPs4FolderParam = async (directory: string, key: string) => {
  const data = await fs.promises
    .readFile(path.join(directory, PARAM_SFO))
    .catch(() => null);
  return data ? parseParamSfoValue(data, key) : null;
};

const sameTitleId = (a: string | null, b: string) =>
  a !== null && a.replace(/\W/g, "").toUpperCase() === b.toUpperCase();

/** Throws when the update PKG does not fit the extracted game folder. */
export const assertPs4UpdateFits = async (
  info: Ps4PkgInfo,
  gameDirectory: string
) => {
  if (!hasGameFiles(gameDirectory)) {
    throw new Ps4PkgError(
      "missing_base_game",
      `No extracted game for update ${info.titleId}`
    );
  }

  const folderTitleId = await readPs4FolderParam(gameDirectory, "TITLE_ID");
  if (folderTitleId && !sameTitleId(folderTitleId, info.titleId)) {
    throw new Ps4PkgError(
      "other_game",
      `Update ${info.titleId} is for another game than ${folderTitleId}`
    );
  }

  const installed = toVersionNumber(
    await readPs4FolderParam(gameDirectory, "APP_VER")
  );
  const update = toVersionNumber(info.appVersion);
  if (installed !== null && update !== null && update <= installed) {
    throw new Ps4PkgError(
      "not_newer",
      `Update ${info.appVersion} is not newer than the installed game`
    );
  }
};

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

/** Moves every file of `source` over `target`, replacing what is there. */
const moveInto = async (source: string, target: string) => {
  await fs.promises.mkdir(target, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await moveInto(from, to);
    } else {
      await fs.promises.rename(from, to);
    }
  }
};

/**
 * An update is extracted next to the game first and only then moved over it,
 * so cancelling or failing during the extraction leaves the game as it was.
 */
const installUpdate = async (
  pkgPath: string,
  gameDirectory: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
) => {
  const staging = path.join(
    path.dirname(gameDirectory),
    `.${path.basename(gameDirectory)}.hydra-update`
  );
  await fs.promises.rm(staging, { recursive: true, force: true });

  try {
    await runWorker(pkgPath, staging, onProgress, signal);
    await moveInto(staging, gameDirectory);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
};

const installGame = async (
  pkgPath: string,
  target: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
) => {
  const createdTarget = !fs.existsSync(target);
  try {
    await runWorker(pkgPath, target, onProgress, signal);
  } catch (error) {
    if (createdTarget) {
      await fs.promises.rm(target, { recursive: true, force: true });
    }
    throw error;
  }
};

export const installPs4Pkg = async ({
  pkgPath,
  gameDirectory,
  onProgress,
  signal,
  deletePkg = false,
}: Ps4PkgInstallOptions): Promise<Ps4PkgInstallResult> => {
  const info = await readPs4PkgInfo(pkgPath);
  if (info.isDeltaPatch) {
    throw new Ps4PkgError("unsupported_pkg", "Delta updates are not supported");
  }

  const besidePkg = path.join(path.dirname(pkgPath), info.titleId);
  let target: string;

  if (info.kind === "game") {
    target = besidePkg;
    await installGame(pkgPath, target, onProgress, signal);
  } else if (info.kind === "patch") {
    target = gameDirectory ?? besidePkg;
    await assertPs4UpdateFits(info, target);
    await installUpdate(pkgPath, target, onProgress, signal);
  } else {
    throw new Ps4PkgError(
      "unsupported_pkg",
      `PKG of kind ${info.kind} is not supported`
    );
  }

  if (deletePkg) await fs.promises.rm(pkgPath, { force: true });
  return { info, gameDirectory: target };
};
