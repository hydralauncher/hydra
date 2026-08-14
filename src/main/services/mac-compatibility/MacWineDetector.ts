import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants, realpath, stat } from "node:fs/promises";
import type {
  MacArchitecture,
  MacWineType,
  MacWineVersion,
} from "./MacCompatibilityTypes";

const execFileAsync = promisify(execFile);

/**
 * A broken or wrongly-detected "wine" must never hang detection. Wine
 * printing its own version is fast; anything slower than this is not
 * something we want to launch a game with anyway.
 */
const VERSION_TIMEOUT_MS = 15_000;
const WHICH_TIMEOUT_MS = 5_000;

export interface WineCandidate {
  id: string;
  name: string;
  type: MacWineType;
  executablePath: string;
  architecture: MacArchitecture | "universal";
}

/**
 * Only real, standalone Wine-compatible executables belong here.
 *
 * Removed vs. the original list: "proton" and "proton-ge". Proton is a
 * Steam Play compatibility tool that expects a Steam-managed environment
 * (STEAM_COMPAT_CLIENT_INSTALL_PATH, STEAM_COMPAT_DATA_PATH) — it is not
 * invoked standalone as `proton --version`, and it has no macOS build.
 * Treating it as a macOS Wine candidate was a category error, not a
 * wrong path.
 *
 * Each remaining candidate now has its own real, distinct executable
 * path instead of every candidate sharing the literal string "wine" —
 * the old list would report 4 "different" Wine installs all pointing at
 * the same binary with the same version string.
 *
 * Absolute Homebrew paths are checked first because a Finder-launched
 * Electron app does not reliably inherit a Terminal's PATH, so relying
 * on `which wine` alone can fail even when Wine is installed.
 */
export const WINE_CANDIDATES: WineCandidate[] = [
  {
    id: "homebrew-wine-arm64",
    name: "Wine (Homebrew, Apple Silicon)",
    type: "wine",
    executablePath: "/opt/homebrew/bin/wine64",
    architecture: "arm64",
  },
  {
    id: "homebrew-wine-arm64-32",
    name: "Wine (Homebrew, Apple Silicon)",
    type: "wine",
    executablePath: "/opt/homebrew/bin/wine",
    architecture: "arm64",
  },
  {
    id: "homebrew-wine-intel",
    name: "Wine (Homebrew, Intel)",
    type: "wine",
    executablePath: "/usr/local/bin/wine64",
    architecture: "x64",
  },
  {
    id: "homebrew-wine-intel-32",
    name: "Wine (Homebrew, Intel)",
    type: "wine",
    executablePath: "/usr/local/bin/wine",
    architecture: "x64",
  },
  {
    id: "crossover",
    name: "CrossOver",
    type: "wine-crossover",
    executablePath:
      "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine",
    architecture: "universal",
  },
  {
    id: "path-wine",
    name: "Wine (PATH)",
    type: "wine",
    executablePath: "wine",
    architecture: "unknown",
  },
];

/**
 * Wine and CrossOver both identify themselves in --version output
 * ("wine-9.0", "wine-8.0.1 (Staging)", "crossover-23.7.1"). Anything
 * else is some other program that merely happens to live at that path.
 */
const WINE_VERSION_PATTERN = /wine|crossover/i;

export class MacWineDetector {
  private readonly candidates: WineCandidate[];

  constructor(candidates: WineCandidate[] = WINE_CANDIDATES) {
    this.candidates = candidates;
  }

  async detectInstalledVersions(): Promise<MacWineVersion[]> {
    const versions: MacWineVersion[] = [];
    const seenExecutablePaths = new Set<string>();

    for (const candidate of this.candidates) {
      // Resolves to a real, runnable absolute path or nothing at all.
      const resolvedPath = await this.resolveExecutable(
        candidate.executablePath,
      );

      if (!resolvedPath) {
        continue;
      }

      // Guards against the same underlying binary being reported twice.
      // The comparison is on the fully resolved path, so a symlink and
      // its target — or PATH "wine" and the Homebrew path it points at —
      // collapse into one entry instead of two look-alike installs.
      if (seenExecutablePaths.has(resolvedPath)) {
        continue;
      }
      seenExecutablePaths.add(resolvedPath);

      // A file existing at a Wine path proves nothing: it could be a
      // directory, a non-executable leftover, a broken symlink, or an
      // unrelated program. Only something that actually runs and
      // identifies itself as Wine is offered to the user, because a
      // fake entry here turns into a failed game launch later.
      const version = await this.getWineVersion(resolvedPath);

      if (!version) {
        continue;
      }

      versions.push({
        id: candidate.id,
        name: candidate.name,
        version,
        type: candidate.type,
        // The resolved absolute path is stored, not the bare "wine"
        // name: a Finder-launched app may not have Homebrew on PATH
        // when the game is eventually launched.
        executablePath: resolvedPath,
        isInstalled: true,
        isRecommended: this.isRecommended(candidate.id),
        architecture: candidate.architecture,
      });
    }

    return versions;
  }

  async isWineAvailable(): Promise<boolean> {
    const versions = await this.detectInstalledVersions();
    return versions.length > 0;
  }

  /**
   * Returns the resolved absolute path when the candidate is a real
   * executable file, or null otherwise.
   */
  private async resolveExecutable(
    executablePath: string,
  ): Promise<string | null> {
    const absolutePath = executablePath.startsWith("/")
      ? executablePath
      : await this.resolveFromPath(executablePath);

    if (!absolutePath) {
      return null;
    }

    try {
      // stat() follows symlinks, so a symlink pointing at a missing
      // file (a common leftover after `brew uninstall`) fails here.
      const stats = await stat(absolutePath);

      if (!stats.isFile()) {
        return null;
      }

      // Existence is not runnability — check the executable bit.
      await access(absolutePath, constants.X_OK);

      return await realpath(absolutePath);
    } catch {
      return null;
    }
  }

  private async resolveFromPath(command: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("which", [command], {
        timeout: WHICH_TIMEOUT_MS,
      });

      const firstLine = stdout.trim().split("\n")[0]?.trim() ?? "";

      return firstLine.startsWith("/") ? firstLine : null;
    } catch {
      return null;
    }
  }

  /**
   * Returns the version string only when the executable really is Wine
   * (or CrossOver's Wine). Returns null when it cannot be run, times
   * out, or identifies itself as something else.
   */
  private async getWineVersion(
    executablePath: string,
  ): Promise<string | null> {
    try {
      const { stdout, stderr } = await execFileAsync(
        executablePath,
        ["--version"],
        {
          timeout: VERSION_TIMEOUT_MS,
        },
      );

      const output = `${stdout}\n${stderr}`.trim();
      const firstLine = output.split("\n")[0]?.trim() ?? "";

      if (!WINE_VERSION_PATTERN.test(firstLine)) {
        return null;
      }

      return firstLine;
    } catch {
      return null;
    }
  }

  /**
   * Recommend Homebrew Wine for the current architecture over PATH-based
   * or CrossOver detection, since it's the most predictable/reproducible
   * install for most users. Falls back naturally if not installed.
   */
  private isRecommended(id: string): boolean {
    return id === "homebrew-wine-arm64" || id === "homebrew-wine-intel";
  }
}
