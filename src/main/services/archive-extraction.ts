import { spawn, type SpawnOptionsWithStdioTuple } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const PROGRESS_INTERVAL_MS = 1000;
const MAX_DIAGNOSTIC_CHARS = 64 * 1024;

export interface ExtractionProgress {
  percent: number;
  fileCount: number;
  file: string;
}

export interface ExtractionResult {
  success: boolean;
  extractedFiles: string[];
}

export interface ArchiveExtractionOptions {
  filePath: string;
  outputPath?: string;
  cwd?: string;
  passwords?: string[];
  collectExtractedFiles?: boolean;
}

export const buildExtractionArgs = (
  filePath: string,
  password: string,
  collectExtractedFiles: boolean,
  reportProgress: boolean
): string[] => [
  "x",
  "-y",
  "-spd",
  "-sccUTF-8",
  collectExtractedFiles ? "-bb1" : "-bb0",
  reportProgress ? "-bsp1" : "-bsp0",
  // An explicit password prevents interactive prompts for encrypted archives.
  `-p${password || "-"}`,
  "--",
  filePath,
];

export const getExtractionSpawnOptions = (
  destination: string,
  platform: NodeJS.Platform = process.platform
): SpawnOptionsWithStdioTuple<"ignore", "pipe", "pipe"> => ({
  cwd: destination,
  // Preserve the original Windows detached-console launch: attaching a
  // console adds startup latency. Pipes remain referenced until close.
  detached: platform === "win32",
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});

class ArchiveExtractionError extends Error {
  readonly passwordRelated: boolean;

  constructor(
    filePath: string,
    code: number | null,
    signal: string | null,
    diagnostics: string
  ) {
    super(
      `7-Zip extraction failed for ${filePath} (exit ${code}${signal ? `, signal ${signal}` : ""}): ${diagnostics.trim()}`
    );
    this.passwordRelated =
      /wrong password|can not open encrypted archive|data error in encrypted file/i.test(
        diagnostics
      );
  }
}

const extractAttempt = (
  binaryPath: string,
  filePath: string,
  destination: string,
  password: string,
  options: ArchiveExtractionOptions,
  onProgress?: (progress: ExtractionProgress) => void
): Promise<ExtractionResult> =>
  new Promise((resolve, reject) => {
    const collectExtractedFiles = options.collectExtractedFiles ?? true;
    const child = spawn(
      binaryPath,
      buildExtractionArgs(
        filePath,
        password,
        collectExtractedFiles,
        Boolean(onProgress)
      ),
      getExtractionSpawnOptions(destination)
    );

    const extractedFiles: string[] = [];
    let partialLine = "";
    let diagnostics = "";
    let spawnError: Error | undefined;
    let lastProgressAt = 0;

    const appendDiagnostic = (text: string) => {
      diagnostics = (diagnostics + text).slice(-MAX_DIAGNOSTIC_CHARS);
    };

    const handleLine = (line: string) => {
      if (collectExtractedFiles && line.startsWith("- ")) {
        extractedFiles.push(line.slice(2).replaceAll("\\", "/"));
        return;
      }

      const progress = /^\s*(\d{1,3})%(?:\s+(\d+))?(?:\s+(.*))?$/.exec(line);
      if (progress) {
        const now = Date.now();
        if (onProgress && now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
          lastProgressAt = now;
          onProgress({
            percent: Math.min(100, Number(progress[1])),
            fileCount: Number(progress[2] ?? extractedFiles.length),
            file: progress[3] ?? "",
          });
        }
      } else if (line.trim()) {
        appendDiagnostic(`${line}\n`);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const lines = (partialLine + chunk).split(/[\r\n\b]+/);
      partialLine = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
      // Bound memory even if a damaged archive produces unterminated output.
      partialLine = partialLine.slice(-MAX_DIAGNOSTIC_CHARS);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", appendDiagnostic);
    child.on("error", (error) => {
      spawnError = error;
    });
    // Wait for close, not just an error event, before retrying or releasing the
    // queue: the failed child must stop writing to the destination first.
    child.on("close", (code, signal) => {
      handleLine(partialLine);
      if (spawnError) {
        reject(spawnError);
      } else if (code !== 0) {
        reject(new ArchiveExtractionError(filePath, code, signal, diagnostics));
      } else {
        onProgress?.({
          percent: 100,
          fileCount: extractedFiles.length,
          file: "",
        });
        resolve({ success: true, extractedFiles });
      }
    });
  });

export const extractArchive = async (
  binaryPath: string,
  options: ArchiveExtractionOptions,
  onProgress?: (progress: ExtractionProgress) => void
): Promise<ExtractionResult> => {
  const filePath = path.resolve(options.filePath);
  const destination = path.resolve(
    options.outputPath ?? options.cwd ?? process.cwd()
  );
  await fs.mkdir(destination, { recursive: true });
  const passwords = [
    ...new Set(options.passwords?.length ? options.passwords : [""]),
  ];

  for (let index = 0; index < passwords.length; index++) {
    try {
      return await extractAttempt(
        binaryPath,
        filePath,
        destination,
        passwords[index],
        options,
        onProgress
      );
    } catch (error) {
      if (
        index === passwords.length - 1 ||
        !(error instanceof ArchiveExtractionError && error.passwordRelated)
      ) {
        throw error;
      }
    }
  }
  throw new Error(`No extraction password attempt was made for ${filePath}`);
};
