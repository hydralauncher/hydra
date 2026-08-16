import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants, stat } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Running a tiny Windows command inside the prefix is normally a couple
 * of seconds. A prefix that needs longer than this is not usable for
 * launching a game, and the check must never hang the app.
 */
const PROBE_TIMEOUT_MS = 60_000;

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
   * system.reg file and a drive_c directory, so those are checked first.
   *
   * File checks alone are not enough, though: `wine --version` (the old
   * test) ignores WINEPREFIX completely and passes even when the prefix
   * is missing or corrupted, and files can be present while the registry
   * inside them is unusable. So after the file checks, one real Windows
   * command is run inside this specific prefix. That is what actually
   * proves the environment can run a game.
   */
  async check(
    prefixPath: string,
    wineExecutablePath: string
  ): Promise<MacWineEnvironmentHealthResult> {
    if (typeof prefixPath !== "string" || prefixPath.trim() === "") {
      return {
        healthy: false,
        initialized: false,
        message: "Wine environment has no prefix path.",
      };
    }

    const initialized = await this.checkPrefixFiles(prefixPath);

    if (!initialized) {
      return {
        healthy: false,
        initialized: false,
        message:
          "Wine environment is missing required files (system.reg or drive_c).",
      };
    }

    if (
      typeof wineExecutablePath !== "string" ||
      wineExecutablePath.trim() === ""
    ) {
      return {
        healthy: true,
        initialized: true,
        message:
          "Wine environment files are present, but no Wine executable was available to test it.",
      };
    }

    const probe = await this.probePrefix(prefixPath, wineExecutablePath);

    if (!probe.ok) {
      return {
        healthy: false,
        initialized: true,
        message: `Wine environment files exist but Wine could not run inside the prefix: ${probe.message}`,
      };
    }

    return {
      healthy: true,
      initialized: true,
      message: "Wine environment is healthy.",
    };
  }

  /**
   * Cheap, Wine-free check: does this folder still look like an
   * initialized Wine prefix? Used on its own when something only needs
   * to know whether the prefix is still there (for example after the
   * user deleted the folder by hand), without paying for a full probe.
   */
  async checkPrefixFiles(prefixPath: string): Promise<boolean> {
    if (typeof prefixPath !== "string" || prefixPath.trim() === "") {
      return false;
    }

    try {
      const prefixStats = await stat(prefixPath);

      if (!prefixStats.isDirectory()) {
        return false;
      }

      await access(join(prefixPath, "system.reg"), constants.F_OK);

      const driveCStats = await stat(join(prefixPath, "drive_c"));

      return driveCStats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Runs a no-op Windows command against this prefix. Unlike
   * `wine --version`, this loads the prefix, so a corrupted or
   * half-initialized prefix fails here instead of passing.
   *
   * Gecko/Mono auto-install prompts are disabled for the probe so a
   * fresh prefix cannot block on a dialog while being tested.
   */
  private async probePrefix(
    prefixPath: string,
    wineExecutablePath: string
  ): Promise<{ ok: boolean; message: string }> {
    try {
      await execFileAsync(wineExecutablePath, ["cmd", "/c", "exit"], {
        timeout: PROBE_TIMEOUT_MS,
        env: {
          ...process.env,
          WINEPREFIX: prefixPath,
          WINEDEBUG: "-all",
          WINEDLLOVERRIDES: "mscoree=d;mshtml=d",
        },
      });

      return { ok: true, message: "Wine ran successfully inside the prefix." };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unknown error while testing the Wine prefix.",
      };
    }
  }
}
