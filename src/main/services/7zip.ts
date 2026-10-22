import { app } from "electron";
import Seven, { CommandLineSwitches } from "node-7z";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { listArchiveEntries, readArchiveEntry } from "./archive-entry";
import {
  extractArchive,
  getExtractionConcurrency,
  getExtractionScheduling,
  type ArchiveExtractionOptions,
  type ExtractionProgress,
  type ExtractionResult,
} from "./archive-extraction";

export type {
  ExtractionProgress,
  ExtractionResult,
} from "./archive-extraction";

export const binaryName = {
  linux: "7zzs",
  darwin: "7zz",
  win32: "7z.exe",
};

export class SevenZip {
  private static readonly binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, binaryName[process.platform])
    : path.join(
        __dirname,
        "..",
        "..",
        "binaries",
        binaryName[process.platform]
      );

  public static listEntries(filePath: string, signal?: AbortSignal) {
    return listArchiveEntries(this.binaryPath, filePath, signal);
  }

  public static readEntry(
    filePath: string,
    entryName: string,
    maxBytes: number,
    signal?: AbortSignal
  ) {
    return readArchiveEntry(
      this.binaryPath,
      filePath,
      entryName,
      maxBytes,
      signal
    );
  }

  public static async extractFile(
    options: ArchiveExtractionOptions,
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult> {
    const startedAt = Date.now();
    const scheduling = getExtractionScheduling(options.filePath);
    logger.info(
      `[7-Zip] Queued extraction of ${options.filePath} (${scheduling.threads} decoder thread(s), ${scheduling.priority} priority, at most ${getExtractionConcurrency()} active extractors)`
    );

    try {
      const result = await extractArchive(
        this.binaryPath,
        {
          ...options,
          onPriorityError: (error) => {
            logger.warn("[7-Zip] Could not lower extraction priority", error);
            options.onPriorityError?.(error);
          },
        },
        onProgress
      );
      logger.info(
        `[7-Zip] Extracted ${options.filePath} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (including queue wait)`
      );
      return result;
    } catch (error) {
      logger.error(`[7-Zip] Extraction failed for ${options.filePath}`, error);
      throw error;
    }
  }

  public static async createZip({
    sourcePath,
    destinationPath,
    signal,
  }: {
    sourcePath: string;
    destinationPath: string;
    signal?: AbortSignal;
  }): Promise<void> {
    signal?.throwIfAborted();
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    signal?.throwIfAborted();

    return new Promise((resolve, reject) => {
      const options: CommandLineSwitches = {
        $bin: this.binaryPath,
        $defer: true,
        yes: true,
        recursive: true,
        noWildcards: true,
      };

      const stream = Seven.add(destinationPath, ".", options);

      const childProcess = spawn(stream._bin, stream._args, {
        cwd: sourcePath,
        windowsHide: true,
      });
      stream._childProcess = childProcess;

      let settled = false;
      let abortRequested = false;

      const abortReason = () =>
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("ZIP creation aborted", "AbortError");

      const settle = (error?: unknown) => {
        if (settled) return;

        settled = true;
        signal?.removeEventListener("abort", onAbort);

        if (error) reject(error);
        else resolve();
      };

      const onAbort = () => {
        if (abortRequested || settled) return;

        abortRequested = true;
        try {
          childProcess.kill();
        } catch (error) {
          settle(error);
        }
      };

      stream.on("end", () =>
        settle(abortRequested ? abortReason() : undefined)
      );
      stream.on("error", (error) =>
        settle(abortRequested ? abortReason() : error)
      );
      Seven.listen(stream);

      signal?.addEventListener("abort", onAbort, { once: true });

      if (signal?.aborted) onAbort();
    });
  }

  public static listFiles(
    filePath: string,
    password?: string
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const files: string[] = [];

      const options: CommandLineSwitches = {
        $bin: this.binaryPath,
        noWildcards: true,
        password: password || undefined,
      };

      const stream = Seven.list(filePath, options);

      stream.on("data", (data) => {
        if (data.file) {
          files.push(data.file);
        }
      });

      stream.on("end", () => {
        resolve(files);
      });

      stream.on("error", (err) => {
        reject(err);
      });
    });
  }
}
