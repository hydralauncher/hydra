import { execFile } from "child_process";
import { promisify } from "util";
import type { MacWineEnvironment } from "../MacCompatibilityTypes";
import { MacWineEnvironmentInitializer } from "./MacWineEnvironmentInitializer";

const execFileAsync = promisify(execFile);

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
      await this.removeBrokenPrefix(
        environment.prefixPath,
        wineExecutablePath,
      );

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

  private async removeBrokenPrefix(
    prefixPath: string,
    wineExecutablePath: string,
  ): Promise<void> {
    try {
      await execFileAsync(
        wineExecutablePath,
        ["wineboot", "--end-session"],
        {
          env: {
            ...process.env,
            WINEPREFIX: prefixPath,
          },
        },
      );
    } catch {
      // The prefix may already be broken enough that wineboot
      // cannot end the session. Continue with reinitialization.
    }
  }
}
