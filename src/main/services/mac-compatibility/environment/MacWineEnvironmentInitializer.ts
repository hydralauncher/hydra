import { execFile } from "child_process";
import { promisify } from "util";
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

      const healthy = await this.verifyPrefix(
        environment.prefixPath,
        wineExecutablePath,
      );

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

  private async verifyPrefix(
    prefixPath: string,
    wineExecutablePath: string,
  ): Promise<boolean> {
    try {
      await execFileAsync(
        wineExecutablePath,
        ["wineboot", "--check"],
        {
          env: {
            ...process.env,
            WINEPREFIX: prefixPath,
          },
        },
      );

      return true;
    } catch {
      return false;
    }
  }
}
