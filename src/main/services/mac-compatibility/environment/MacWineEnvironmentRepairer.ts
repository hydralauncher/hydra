import { rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MacWineEnvironment } from "../MacCompatibilityTypes";
import { MacWineEnvironmentInitializer } from "./MacWineEnvironmentInitializer";
import { MacWineEnvironmentLogger } from "./MacWineEnvironmentLogger";
import {
  DEFAULT_MAC_ENVIRONMENTS_PATH,
  assertManagedPrefixPath,
  assertPathInsidePrefix,
} from "./MacWineEnvironmentPaths";

export interface MacWineEnvironmentRepairResult {
  success: boolean;
  environment: MacWineEnvironment;
  message: string;
}

export class MacWineEnvironmentRepairer {
  private readonly initializer: MacWineEnvironmentInitializer;
  private readonly environmentsPath: string;

  constructor(environmentsPath = DEFAULT_MAC_ENVIRONMENTS_PATH) {
    this.initializer = new MacWineEnvironmentInitializer();
    this.environmentsPath = environmentsPath;
  }

  async repair(
    environment: MacWineEnvironment,
    wineExecutablePath: string
  ): Promise<MacWineEnvironmentRepairResult> {
    try {
      await MacWineEnvironmentLogger.warning(
        environment.prefixPath,
        "Repair started: removing corrupted Wine prefix contents."
      );

      await this.removeBrokenPrefix(environment.prefixPath);

      const result = await this.initializer.initialize(
        {
          ...environment,
          initialized: false,
          healthy: false,
          updatedAt: new Date().toISOString(),
        },
        wineExecutablePath
      );

      if (result.success) {
        await MacWineEnvironmentLogger.info(
          environment.prefixPath,
          "Repair completed: Wine environment reinitialized successfully."
        );
      } else {
        await MacWineEnvironmentLogger.error(
          environment.prefixPath,
          "Repair failed during reinitialization.",
          result.message
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
        message
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
   * The prefix path arrives from environments.json, so it is never
   * trusted as-is. assertManagedPrefixPath() re-validates it against
   * the environments root immediately before anything is deleted, and
   * every individual entry is re-checked to be inside that validated
   * folder. An unsafe path throws and deletes nothing.
   */
  private async removeBrokenPrefix(prefixPath: string): Promise<void> {
    const safePrefixPath = await assertManagedPrefixPath(
      this.environmentsPath,
      prefixPath
    );

    let entries: string[];
    try {
      entries = await readdir(safePrefixPath);
    } catch {
      // Prefix folder doesn't exist yet — nothing to remove.
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry !== "compatibility.log")
        .map((entry) =>
          rm(
            assertPathInsidePrefix(safePrefixPath, join(safePrefixPath, entry)),
            { recursive: true, force: true }
          )
        )
    );
  }
}
