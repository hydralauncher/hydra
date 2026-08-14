import { rm } from "node:fs/promises";
import type { MacWineEnvironment } from "../MacCompatibilityTypes";
import { MacWineEnvironmentInitializer } from "./MacWineEnvironmentInitializer";

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
   * outright so initialize() below starts from a clean state.
   *
   * Only ever deletes environment.prefixPath as resolved upstream by
   * MacWineEnvironmentManager (userData/mac-compatibility/environments/
   * <sanitized-shop>-<sanitized-objectId>) — never a caller-supplied or
   * constructed path.
   */
  private async removeBrokenPrefix(prefixPath: string): Promise<void> {
    if (!prefixPath) {
      throw new Error(
        "Refusing to repair: no prefix path was provided.",
      );
    }

    await rm(prefixPath, {
      recursive: true,
      force: true,
    });
  }
}
