import { app } from "electron";
import Seven, { CommandLineSwitches } from "node-7z";
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

  public static extractFile(
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
    return new Promise((resolve, reject) => {
      const tryPassword = (index = 0) => {
        const password = passwords[index] ?? "";
        logger.info(
          `Trying password "${password || "(empty)"}" on ${filePath}`
        );

        const extractedFiles: string[] = [];
        let fileCount = 0;

        const options: CommandLineSwitches = {
          $bin: this.binaryPath,
          $progress: true,
          yes: true,
          password: password || undefined,
        };

        if (outputPath) {
          options.outputDir = outputPath;
        }

        const stream = Seven.extractFull(filePath, outputPath || cwd || ".", {
          ...options,
          $spawnOptions: cwd ? { cwd } : undefined,
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
          logger.info(
            `Successfully extracted ${filePath} (${extractedFiles.length} files)`
          );
          resolve({
            success: true,
            extractedFiles,
          });
        });

        stream.on("error", (err) => {
          logger.error(`Extraction error for ${filePath}:`, err);

          if (index < passwords.length - 1) {
            logger.info(
              `Failed to extract file: ${filePath} with password: "${password}". Trying next password...`
            );
            tryPassword(index + 1);
          } else {
            logger.error(
              `Failed to extract file: ${filePath} after trying all passwords`
            );
            reject(new Error(`Failed to extract file: ${filePath}`));
          }
        });
      };

      tryPassword(0);
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
