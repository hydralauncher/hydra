import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface MacWineEnvironmentHealthResult {
  healthy: boolean;
  initialized: boolean;
  message: string;
}

export class MacWineEnvironmentHealthChecker {
  async check(
    prefixPath: string,
    wineExecutablePath: string,
  ): Promise<MacWineEnvironmentHealthResult> {
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

      return {
        healthy: true,
        initialized: true,
        message: "Wine environment is healthy.",
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Wine environment health check failed.";

      return {
        healthy: false,
        initialized: false,
        message,
      };
    }
  }
}
