import { access, constants } from "node:fs/promises";
import { join } from "node:path";

export interface MacWineEnvironmentHealthResult {
  healthy: boolean;
  initialized: boolean;
  message: string;
}

export class MacWineEnvironmentHealthChecker {
  /**
   * Wine has no valid "wineboot --check" subcommand — that call always
   * fails regardless of prefix state, which made this always report
   * unhealthy. A real Wine prefix, once initialized, always has a
   * system.reg file and a drive_c directory; checking for those directly
   * is what actually verifies the prefix exists and was initialized.
   */
  async check(
    prefixPath: string,
    _wineExecutablePath: string,
  ): Promise<MacWineEnvironmentHealthResult> {
    const systemRegPath = join(prefixPath, "system.reg");
    const driveCPath = join(prefixPath, "drive_c");

    try {
      await access(systemRegPath, constants.F_OK);
      await access(driveCPath, constants.F_OK);

      return {
        healthy: true,
        initialized: true,
        message: "Wine environment is healthy.",
      };
    } catch {
      return {
        healthy: false,
        initialized: false,
        message:
          "Wine environment is missing required files (system.reg or drive_c).",
      };
    }
  }
}
