import { appendFile, mkdir } from "node:fs/promises";
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
 * log file living alongside its Wine prefix (same directory the prefix
 * itself lives in — see MacWineEnvironmentManager's environmentsPath),
 * so a game's whole compatibility history is in one place and one
 * game's logs never mix with another's.
 *
 * This exists specifically so the future "Fix Everything" / diagnostics
 * UI (Phase 4) has real history to show instead of only the current
 * status. Kept as a small, focused class per this codebase's convention
 * — callers (environment manager, initializer, repairer) call log()
 * inline rather than this class knowing about Wine operations itself.
 */
export class MacWineEnvironmentLogger {
  private static readonly MAX_ENTRIES = 500;

  private static logFilePath(prefixPath: string): string {
    // prefixPath IS the per-game environment folder itself (see
    // MacWineEnvironmentManager.createEnvironment: prefixPath =
    // join(environmentsPath, environmentId) — there is no extra
    // subfolder). The log lives inside that same folder, alongside the
    // Wine prefix contents, so it's scoped to exactly one game and
    // never mixes with another game's logs.
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
      await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch (error) {
      // Logging must never break the operation it's logging. Swallow
      // failures here — the compatibility system should keep working
      // even if disk logging temporarily fails.
      console.error(
        "[MacWineEnvironmentLogger] Failed to write log entry:",
        error,
      );
    }
  }

  static async info(prefixPath: string, message: string, detail?: string) {
    return this.log(prefixPath, "info", message, detail);
  }

  static async warning(prefixPath: string, message: string, detail?: string) {
    return this.log(prefixPath, "warning", message, detail);
  }

  static async error(prefixPath: string, message: string, detail?: string) {
    return this.log(prefixPath, "error", message, detail);
  }
}
