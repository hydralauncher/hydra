import { rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MacWineEnvironment } from "../MacCompatibilityTypes";
import { MacWineEnvironmentInitializer } from "./MacWineEnvironmentInitializer";
import { MacWineEnvironmentLogger } from "./MacWineEnvironmentLogger";

export interface MacWineEnvironmentRepairResult {
  success: boolean;
  environment: MacWineEnvironment;
  message: string;
}

export class MacWineEnvironmentRepairer {
  private readonly initializer: MacWineEnvironmentInitializer;

  constructor() {
    this.initializer = new MacWineEnvironmentInitializer();
  }

  async repair(
    environment: MacWineEnvironment,
    wineExecutablePath: string,
  ): Promise<MacWineEnvironmentRepairResult> {
    try {
      await MacWineEnvironmentLogger.warning(
        environment.prefixPath,
        "Repair started: removing corrupted Wine prefix contents.",
      );

      await this.removeBrokenPrefix(environment.prefixPath);

      const result = await this.initializer.initialize(
        {
          ...environment,
          initialized: false,
          healthy: false,
          updatedAt: new Date().toISOString(),
        },
        wineExecutablePath,
      );

      if (result.success) {
        await MacWineEnvironmentLogger.info(
          environment.prefixPath,
          "Repair completed: Wine environment reinitialized successfully.",
        );
      } else {
        await MacWineEnvironmentLogger.error(
          environment.prefixPath,
          "Repair failed during reinitialization.",
          result.message,
        );
      }

      return {
        success: result.success,
        environment: result.environment,
        message: result.success
          ? "Wine environment repaired successfully."
          : result.message,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while repairing Wine environment.";

      await MacWineEnvironmentLogger.error(
        environment.prefixPath,
        "Repair failed unexpectedly.",
        message,
      );

      return {
        success: false,
        environment: {
          ...environment,
          initialized: false,
          healthy: false,
          updatedAt: new Date().toISOString(),
        },
        message,
      };
    }
  }

  /**
   * "wineboot --end-session" is not a valid Wine command and never
   * deleted anything — repair was re-initializing over the same
   * corrupted files every time. This deletes the prefix directory
   * contents outright so initialize() below starts from a clean state.
   *
   * IMPORTANT: prefixPath is the whole per-game environment folder
   * (Wine prefix contents AND compatibility.log live side by side in
   * it — see MacWineEnvironmentLogger). A repair wipes the broken Wine
   * files but must not destroy that game's log history in the process,
   * so this deletes every entry in the folder except compatibility.log
   * instead of rm-ing the folder itself.
   *
   * Only ever deletes contents of environment.prefixPath as resolved
   * upstream by MacWineEnvironmentManager (userData/mac-compatibility/
   * environments/<sanitized-shop>-<sanitized-objectId>) — never a
   * caller-supplied or constructed path.
   */
  private async removeBrokenPrefix(prefixPath: string): Promise<void> {
    if (!prefixPath) {
      throw new Error(
        "Refusing to repair: no prefix path was provided.",
      );
    }

    let entries: string[];
    try {
      entries = await readdir(prefixPath);
    } catch {
      // Prefix folder doesn't exist yet — nothing to remove.
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry !== "compatibility.log")
        .map((entry) =>
          rm(join(prefixPath, entry), { recursive: true, force: true }),
        ),
    );
  }
}
