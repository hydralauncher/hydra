import { execFile } from "child_process";
import { promisify } from "util";
import type {
  MacArchitecture,
  MacWineType,
  MacWineVersion,
} from "./MacCompatibilityTypes";

const execFileAsync = promisify(execFile);

interface WineCandidate {
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
const WINE_CANDIDATES: WineCandidate[] = [
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

export class MacWineDetector {
  async detectInstalledVersions(): Promise<MacWineVersion[]> {
    const versions: MacWineVersion[] = [];
    const seenExecutablePaths = new Set<string>();

    for (const candidate of WINE_CANDIDATES) {
      const installed = await this.isExecutableAvailable(
        candidate.executablePath,
      );

      if (!installed) {
        continue;
      }

      // Guards against the same underlying binary being reported twice
      // (e.g. a symlink resolving PATH "wine" to the same file as an
      // already-found absolute path).
      if (seenExecutablePaths.has(candidate.executablePath)) {
        continue;
      }
      seenExecutablePaths.add(candidate.executablePath);

      const version = await this.getWineVersion(candidate.executablePath);

      versions.push({
        id: candidate.id,
        name: candidate.name,
        version,
        type: candidate.type,
        executablePath: candidate.executablePath,
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

  private async isExecutableAvailable(
    executablePath: string,
  ): Promise<boolean> {
    try {
      if (executablePath.startsWith("/")) {
        const { access } = await import("fs/promises");
        await access(executablePath);
        return true;
      }

      await execFileAsync("which", [executablePath]);
      return true;
    } catch {
      return false;
    }
  }

  private async getWineVersion(executablePath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(executablePath, ["--version"]);
      return stdout.trim() || "unknown";
    } catch {
      return "unknown";
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
