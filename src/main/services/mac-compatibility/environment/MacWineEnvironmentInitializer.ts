import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import type { MacWineEnvironment } from "../MacCompatibilityTypes";

const execFileAsync = promisify(execFile);

export interface MacWineEnvironmentInitializationResult {
  success: boolean;
  environment: MacWineEnvironment;
  message: string;
}

export class MacWineEnvironmentInitializer {
  async initialize(
    environment: MacWineEnvironment,
    wineExecutablePath: string,
  ): Promise<MacWineEnvironmentInitializationResult> {
    try {
      await this.initializePrefix(
        environment.prefixPath,
        wineExecutablePath,
      );

      const healthy = await this.verifyPrefix(environment.prefixPath);

      const updatedEnvironment: MacWineEnvironment = {
        ...environment,
        exists: true,
        initialized: healthy,
        healthy,
        updatedAt: new Date().toISOString(),
      };

      return {
        success: healthy,
        environment: updatedEnvironment,
        message: healthy
          ? "Wine environment initialized successfully."
          : "Wine environment was created but could not be verified.",
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error while initializing Wine environment.";

      return {
        success: false,
        environment: {
          ...environment,
          exists: true,
          initialized: false,
          healthy: false,
          updatedAt: new Date().toISOString(),
        },
        message,
      };
    }
  }

  private async initializePrefix(
    prefixPath: string,
    wineExecutablePath: string,
  ): Promise<void> {
    await execFileAsync(
      wineExecutablePath,
      ["wineboot", "--init"],
      {
        env: {
          ...process.env,
          WINEPREFIX: prefixPath,
        },
      },
    );
  }

  /**
   * "wineboot --check" is not a valid Wine subcommand and always failed,
   * regardless of prefix state. A freshly initialized prefix always has
   * a system.reg file and a drive_c directory — checking for those
   * directly is what actually verifies initialization succeeded.
   */
  private async verifyPrefix(prefixPath: string): Promise<boolean> {
    try {
      await access(join(prefixPath, "system.reg"), constants.F_OK);
      await access(join(prefixPath, "drive_c"), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
