import { app } from "electron";
import Seven, { CommandLineSwitches } from "node-7z";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

export const binaryName = {
  linux: "7zzs",
  darwin: "7zz",
  win32: "7z.exe",
};

export interface ExtractionProgress {
  percent: number;
  fileCount: number;
  file: string;
}

export interface ExtractionResult {
  success: boolean;
  extractedFiles: string[];
}

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

  private static isPasswordRelatedError(error: unknown): boolean {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? "");
    const normalizedMessage = errorMessage.toLowerCase();

    return (
      normalizedMessage.includes("wrong password") ||
      normalizedMessage.includes("can not open encrypted archive") ||
      normalizedMessage.includes("encrypted")
    );
  }

  public static async extractFile(
    {
      filePath,
      outputPath,
      cwd,
      passwords = [],
    }: {
      filePath: string;
      outputPath?: string;
      cwd?: string;
      passwords?: string[];
    },
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult> {
    const destination = outputPath ?? cwd ?? process.cwd();

    await fs.promises.mkdir(destination, { recursive: true });

    return new Promise((resolve, reject) => {
      let settled = false;
      let activeAttempt = 0;

      const tryPassword = (index = 0) => {
        const attemptId = ++activeAttempt;
        const password = passwords[index] ?? "";
        logger.info(
          `Trying password "${password || "(empty)"}" on ${filePath}`
        );

        const extractedFiles: string[] = [];
        let fileCount = 0;

        const options: CommandLineSwitches = {
          $bin: this.binaryPath,
          $progress: true,
          $defer: true,
          yes: true,
          noWildcards: true,
          password: password || undefined,
        };

        const stream = Seven.extractFull(filePath, ".", options);

        stream._childProcess = spawn(stream._bin, stream._args, {
          cwd: destination,
          detached: true,
          windowsHide: true,
        });

        stream.on("progress", (progress) => {
          if (onProgress) {
            onProgress({
              percent: progress.percent,
              fileCount: fileCount,
              file: progress.fileCount?.toString() || "",
            });
          }
        });

        stream.on("data", (data) => {
          if (data.file) {
            extractedFiles.push(data.file);
            fileCount++;
          }
        });

        stream.on("end", () => {
          if (settled || attemptId !== activeAttempt) {
            return;
          }

          settled = true;
          logger.info(
            `Successfully extracted ${filePath} (${extractedFiles.length} files)`
          );
          resolve({
            success: true,
            extractedFiles,
          });
        });

        stream.on("error", (err) => {
          if (settled || attemptId !== activeAttempt) {
            return;
          }

          logger.error(`Extraction error for ${filePath}:`, err);

          const shouldTryNextPassword =
            index < passwords.length - 1 && this.isPasswordRelatedError(err);

          if (shouldTryNextPassword) {
            logger.info(
              `Failed to extract file: ${filePath} with password: "${password}". Trying next password...`
            );
            tryPassword(index + 1);
          } else {
            settled = true;
            logger.error(
              `Failed to extract file: ${filePath} after trying all passwords`
            );
            reject(new Error(`Failed to extract file: ${filePath}`));
          }
        });

        Seven.listen(stream);
      };

      tryPassword(0);
    });
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
