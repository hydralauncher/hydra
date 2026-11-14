import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

import workerPath from "./ps4-pkg-worker?modulePath";
import { NativeAddon } from "../native-addon";
import { forgetPs4PkgKeys, getPs4PkgKeys } from "./ps4-pkg-keys-store";
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
  pkgBytes?: number;
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

/**
 * Workers that split the files of a PKG. Decrypting is CPU bound: on the
 * Crash Team Racing PKG (14 GB) 4 workers took 96 s against 247 s for one.
 */
const MAX_EXTRACTION_WORKERS = 4;
const WORKER_STOP_TIMEOUT_MS = 5_000;

const workerCount = () =>
  Math.max(1, Math.min(MAX_EXTRACTION_WORKERS, os.availableParallelism() - 1));

const runWorkers = async (
  pkgPath: string,
  outputDirectory: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
) => {
  const keys = await getPs4PkgKeys();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Ps4PkgError("cancelled", "Extraction cancelled"));
      return;
    }

    const count = workerCount();
    const nativeAddonPath = NativeAddon.getAddonPath();
    const written = new Array<number>(count).fill(0);
    const workers: Worker[] = [];
    const exits: Promise<unknown>[] = [];
    // Workers stop themselves at the next block when this is set, closing
    // their files; terminate() would leave those file descriptors open.
    const stopFlag = new Int32Array(new SharedArrayBuffer(4));
    let pkgBytes = 0;
    let finished = 0;
    let settled = false;

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        // Waits for every worker to stop, so the caller can clean up safely.
        Atomics.store(stopFlag, 0, 1);
        const stopped = Promise.allSettled(exits);
        const timeout = new Promise((done) =>
          setTimeout(done, WORKER_STOP_TIMEOUT_MS).unref()
        );
        void Promise.race([stopped, timeout])
          .then(() =>
            Promise.allSettled(workers.map((worker) => worker.terminate()))
          )
          .then(() => reject(error));
      } else {
        resolve();
      }
    };
    const onAbort = () =>
      settle(new Ps4PkgError("cancelled", "Extraction cancelled"));
    signal?.addEventListener("abort", onAbort);

    for (let index = 0; index < count; index++) {
      const worker = new Worker(workerPath, {
        workerData: {
          pkgPath,
          outputDirectory,
          shard: { index, count },
          nativeAddonPath,
          keys,
          stopFlag: stopFlag.buffer,
        },
      });
      workers.push(worker);
      exits.push(new Promise((done) => worker.once("exit", done)));
      let done = false;

      worker.on("message", (message: WorkerMessage) => {
        if (message.type === "progress") {
          written[index] = message.writtenBytes ?? 0;
          pkgBytes = message.pkgBytes ?? pkgBytes;
          if (pkgBytes > 0) {
            const sum = written.reduce((total, bytes) => total + bytes, 0);
            onProgress?.(Math.min(1, sum / pkgBytes));
          }
        } else if (message.type === "done") {
          done = true;
          finished += 1;
          if (finished === count) settle();
        } else if (message.type === "error") {
          if (message.code === "bad_keys") {
            void forgetPs4PkgKeys().catch(() => undefined);
          }
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
        if (done) return;
        settle(
          new Ps4PkgError(
            "failed",
            code === 0
              ? "PKG worker stopped early"
              : `PKG worker exited with ${code}`
          )
        );
      });
    }
  });
};

/** Moves every file of `source` over `target`, replacing what is there. */
const moveInto = async (
  source: string,
  target: string,
  last?: string
): Promise<void> => {
  await fs.promises.mkdir(target, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (from === last) continue;
    if (entry.isDirectory()) {
      await moveInto(from, to, last);
    } else {
      await fs.promises.rename(from, to);
    }
  }
};

/**
 * An update is extracted next to the game first and only then moved over it,
 * so cancelling or failing during the extraction leaves the game as it was.
 * The version file moves last: if moving stops halfway, the game still reads
 * as the old version and applying the update again finishes it.
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
    await runWorkers(pkgPath, staging, onProgress, signal);
    const stagedParam = path.join(staging, PARAM_SFO);
    await moveInto(staging, gameDirectory, stagedParam);
    if (fs.existsSync(stagedParam)) {
      await fs.promises.rename(
        stagedParam,
        path.join(gameDirectory, PARAM_SFO)
      );
    }
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
};

const hasPs4Title = async (directory: string, titleId: string) =>
  hasGameFiles(directory) &&
  sameTitleId(await readPs4FolderParam(directory, "TITLE_ID"), titleId);

/**
 * A game is extracted next to its target and swapped in at the end, so an
 * existing folder (maybe already updated) is never left half overwritten.
 * A folder that already has this game is kept as it is, and a folder with
 * anything else is never replaced.
 */
const installGame = async (
  pkgPath: string,
  info: Ps4PkgInfo,
  target: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
) => {
  if (await hasPs4Title(target, info.titleId)) return;
  if (fs.existsSync(target)) {
    throw new Ps4PkgError(
      "failed",
      `${target} already exists and is not ${info.titleId}`
    );
  }

  const staging = path.join(
    path.dirname(target),
    `.${path.basename(target)}.hydra-install`
  );
  await fs.promises.rm(staging, { recursive: true, force: true });
  try {
    await runWorkers(pkgPath, staging, onProgress, signal);
    await fs.promises.rename(staging, target);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
};

// Two PKGs written at once could land in the same game folder (a download
// finishing while an update is applied), so installs run one at a time.
let installQueue: Promise<unknown> = Promise.resolve();

const runInQueue = <T>(task: () => Promise<T>): Promise<T> => {
  const result = installQueue.then(task, task);
  installQueue = result.catch(() => undefined);
  return result;
};

export const installPs4Pkg = (
  options: Ps4PkgInstallOptions
): Promise<Ps4PkgInstallResult> => runInQueue(() => installNow(options));

const installNow = async ({
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
    await installGame(pkgPath, info, target, onProgress, signal);
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
