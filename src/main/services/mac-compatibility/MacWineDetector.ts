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

const WINE_CANDIDATES: WineCandidate[] = [
  {
    id: "system-wine",
    name: "Wine",
    type: "wine",
    executablePath: "wine",
    architecture: "universal",
  },
  {
    id: "wine-staging",
    name: "Wine Staging",
    type: "wine-staging",
    executablePath: "wine",
    architecture: "universal",
  },
  {
    id: "crossover",
    name: "CrossOver",
    type: "wine-crossover",
    executablePath: "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine",
    architecture: "universal",
  },
  {
    id: "proton",
    name: "Proton",
    type: "proton",
    executablePath: "wine",
    architecture: "universal",
  },
  {
    id: "proton-ge",
    name: "Proton-GE",
    type: "proton-ge",
    executablePath: "wine",
    architecture: "universal",
  },
];

export class MacWineDetector {
  async detectInstalledVersions(): Promise<MacWineVersion[]> {
    const versions: MacWineVersion[] = [];

    for (const candidate of WINE_CANDIDATES) {
      const installed = await this.isExecutableAvailable(
        candidate.executablePath,
      );

      if (!installed) {
        continue;
      }

      const version = await this.getWineVersion(candidate.executablePath);

      versions.push({
        id: candidate.id,
        name: candidate.name,
        version,
        type: candidate.type,
        executablePath: candidate.executablePath,
        isInstalled: true,
        isRecommended: this.isRecommended(candidate.type),
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

  private isRecommended(type: MacWineType): boolean {
    return type === "wine-staging" || type === "proton-ge";
  }
}
