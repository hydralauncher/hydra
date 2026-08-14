import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export type MacWineEnvironmentLogLevel = "info" | "warning" | "error";

export interface MacWineEnvironmentLogEntry {
  timestamp: string;
  level: MacWineEnvironmentLogLevel;
  message: string;
  detail?: string;
}

/**
 * Per-game compatibility log. Each game's compatibility box gets its own
 * log file living alongside its Wine prefix.
 *
 * The log is intentionally bounded to MAX_ENTRIES entries so repeated
 * compatibility checks cannot cause the file to grow forever.
 */
export class MacWineEnvironmentLogger {
  private static readonly MAX_ENTRIES = 500;

  private static logFilePath(prefixPath: string): string {
    return join(prefixPath, "compatibility.log");
  }

  static async log(
    prefixPath: string,
    level: MacWineEnvironmentLogLevel,
    message: string,
    detail?: string,
  ): Promise<void> {
    const entry: MacWineEnvironmentLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(detail ? { detail } : {}),
    };

    const logPath = this.logFilePath(prefixPath);

    try {
      await mkdir(dirname(logPath), { recursive: true });

      let entries: MacWineEnvironmentLogEntry[] = [];

      try {
        const existing = await readFile(logPath, "utf8");

        entries = existing
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as MacWineEnvironmentLogEntry);
      } catch {
        // The log does not exist yet, or an existing log could not be read.
        // Start a fresh log rather than allowing logging to break the
        // compatibility operation.
        entries = [];
      }

      entries.push(entry);

      const trimmedEntries = entries.slice(-MacWineEnvironmentLogger.MAX_ENTRIES);

      await writeFile(
        logPath,
        `${trimmedEntries.map((item) => JSON.stringify(item)).join("\n")}\n`,
        "utf8",
      );
    } catch (error) {
      // Logging must never break the operation it's logging.
      console.error(
        "[MacWineEnvironmentLogger] Failed to write log entry:",
        error,
      );
    }
  }

  static async info(
    prefixPath: string,
    message: string,
    detail?: string,
  ): Promise<void> {
    return this.log(prefixPath, "info", message, detail);
  }

  static async warning(
    prefixPath: string,
    message: string,
    detail?: string,
  ): Promise<void> {
    return this.log(prefixPath, "warning", message, detail);
  }

  static async error(
    prefixPath: string,
    message: string,
    detail?: string,
  ): Promise<void> {
    return this.log(prefixPath, "error", message, detail);
  }
}
