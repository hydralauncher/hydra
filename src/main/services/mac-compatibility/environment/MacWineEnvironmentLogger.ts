import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type MacWineEnvironmentLogLevel = "info" | "warning" | "error";

export interface MacWineEnvironmentLogEntry {
  timestamp: string;
  level: MacWineEnvironmentLogLevel;
  message: string;
  detail?: string;
}

/**
 * Per-game compatibility log.
 *
 * Each game's compatibility box gets its own log file inside its
 * environment directory. This keeps compatibility history isolated
 * between games and gives the future diagnostics UI real information
 * to display.
 */
export class MacWineEnvironmentLogger {
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
      await mkdir(prefixPath, { recursive: true });
      await appendFile(
        logPath,
        `${JSON.stringify(entry)}\n`,
        "utf8",
      );
    } catch (error) {
      // Logging must never break the compatibility operation itself.
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
