import { spawn, type SpawnOptionsWithStdioTuple } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PROGRESS_INTERVAL_MS = 1000;
const MAX_DIAGNOSTIC_CHARS = 64 * 1024;
const AVAILABLE_THREADS = os.availableParallelism();

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
  onPriorityError?: (error: unknown) => void;
}

export const getExtractionThreadCount = (
  availableThreads = AVAILABLE_THREADS
): number => Math.max(1, Math.min(8, Math.floor(availableThreads / 2)));

export const getExtractionConcurrency = (
  availableThreads = AVAILABLE_THREADS
): number => (availableThreads >= 4 ? 2 : 1);

export interface ExtractionScheduling {
  threads: number;
  priority: "below-normal";
}

export const getExtractionScheduling = (
  filePath: string,
  availableThreads = AVAILABLE_THREADS
): ExtractionScheduling => {
  const isZip = path.extname(filePath).toLowerCase() === ".zip";
  return {
    // Common ZIP Store/Deflate decoding is single-threaded. Give it a small
    // reservation, rather than blocking unrelated ZIPs behind a full CPU budget.
    threads: isZip ? 1 : getExtractionThreadCount(availableThreads),
    priority: "below-normal",
  };
};

interface QueuedExtraction {
  threads: number;
  destination?: string;
  start: () => void;
}

const normalizeDestination = (destination: string): string => {
  const resolved = path.resolve(destination);
  return process.platform === "win32" || process.platform === "darwin"
    ? resolved.toLowerCase()
    : resolved;
};

const isWithin = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
};

export class ArchiveExtractionQueue {
  private readonly pending: QueuedExtraction[] = [];
  private readonly active = new Set<QueuedExtraction>();
  private reservedThreads = 0;

  constructor(
    private readonly threadBudget = getExtractionThreadCount(),
    private readonly concurrency = getExtractionConcurrency()
  ) {
    if (
      !Number.isInteger(threadBudget) ||
      threadBudget < 1 ||
      !Number.isInteger(concurrency) ||
      concurrency < 1
    ) {
      throw new RangeError("Extraction budgets must be positive integers");
    }
  }

  run<T>(
    operation: () => Promise<T>,
    {
      threads = this.threadBudget,
      destination,
    }: { threads?: number; destination?: string } = {}
  ): Promise<T> {
    if (
      !Number.isInteger(threads) ||
      threads < 1 ||
      threads > this.threadBudget
    ) {
      return Promise.reject(
        new RangeError("Invalid extraction thread reservation")
      );
    }
    return new Promise<T>((resolve, reject) => {
      const job: QueuedExtraction = {
        threads,
        destination:
          destination === undefined
            ? undefined
            : normalizeDestination(destination),
        start: () => {
          void Promise.resolve()
            .then(operation)
            .then(
              (value) => {
                this.complete(job);
                resolve(value);
              },
              (error) => {
                this.complete(job);
                reject(error);
              }
            );
        },
      };
      this.pending.push(job);
      this.drain();
    });
  }

  private complete(job: QueuedExtraction) {
    this.active.delete(job);
    this.reservedThreads -= job.threads;
    this.drain();
  }

  private drain() {
    while (this.pending.length && this.active.size < this.concurrency) {
      const next = this.pending[0];
      const destination = next.destination;
      const conflicts =
        destination !== undefined &&
        [...this.active].some(
          (job) =>
            job.destination !== undefined &&
            (isWithin(job.destination, destination) ||
              isWithin(destination, job.destination))
        );
      // FIFO admission prevents a stream of small ZIPs from starving a waiting
      // CPU-heavy job. Aliased/nested output directories must not have two writers.
      if (this.reservedThreads + next.threads > this.threadBudget || conflicts)
        return;
      this.pending.shift();
      this.reservedThreads += next.threads;
      this.active.add(next);
      next.start();
    }
  }
}

const extractionQueue = new ArchiveExtractionQueue();

export const buildExtractionArgs = (
  filePath: string,
  password: string,
  collectExtractedFiles: boolean,
  reportProgress: boolean,
  threads = getExtractionThreadCount()
): string[] => [
  "x",
  "-y",
  "-spd",
  "-sccUTF-8",
  collectExtractedFiles ? "-bb1" : "-bb0",
  reportProgress ? "-bsp1" : "-bsp0",
  `-mmt=${threads}`,
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
  scheduling: ExtractionScheduling,
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
        Boolean(onProgress),
        scheduling.threads
      ),
      getExtractionSpawnOptions(destination)
    );

    if (child.pid !== undefined) {
      try {
        // Below-normal (not idle) priority yields to foreground apps without
        // throttling extraction when the PC is otherwise idle.
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch (error) {
        options.onPriorityError?.(error);
      }
    }

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
  const canonicalDestination = await fs.realpath(destination);
  const scheduling = getExtractionScheduling(filePath);

  return extractionQueue.run(
    async () => {
      const passwords = [
        ...new Set(options.passwords?.length ? options.passwords : [""]),
      ];

      for (let index = 0; index < passwords.length; index++) {
        try {
          return await extractAttempt(
            binaryPath,
            filePath,
            canonicalDestination,
            passwords[index],
            options,
            scheduling,
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

      throw new Error(
        `No extraction password attempt was made for ${filePath}`
      );
    },
    { threads: scheduling.threads, destination: canonicalDestination }
  );
};
