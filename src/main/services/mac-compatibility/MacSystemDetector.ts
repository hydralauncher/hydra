import { execFile } from "child_process";
import { promisify } from "util";
import type { MacArchitecture, MacSystemInfo } from "./MacCompatibilityTypes";

const execFileAsync = promisify(execFile);

export class MacSystemDetector {
  async detect(): Promise<MacSystemInfo> {
    const architecture = await this.detectArchitecture();
    const osVersion = await this.getMacOSVersion();
    const computerName = await this.getComputerName();
    const memoryBytes = await this.getMemoryBytes();
    const availableDiskBytes = await this.getAvailableDiskBytes();

    return {
      platform: "macos",
      architecture,
      osVersion,
      computerName,
      isAppleSilicon: architecture === "arm64",
      isIntel: architecture === "x64",
      memoryBytes,
      availableDiskBytes,
      wineAvailable: await this.commandExists("wine"),
      protonAvailable: await this.commandExists("proton"),
      rosettaAvailable: await this.detectRosetta(),
    };
  }

  private async detectArchitecture(): Promise<MacArchitecture> {
    try {
      const { stdout } = await execFileAsync("uname", ["-m"]);
      const architecture = stdout.trim();

      if (architecture === "arm64") {
        return "arm64";
      }

      if (architecture === "x86_64") {
        return "x64";
      }

      return "unknown";
    } catch {
      return "unknown";
    }
  }

  private async getMacOSVersion(): Promise<string> {
    try {
      const { stdout } = await execFileAsync("sw_vers", ["-productVersion"]);
      return stdout.trim();
    } catch {
      return "unknown";
    }
  }

  private async getComputerName(): Promise<string> {
    try {
      const { stdout } = await execFileAsync("scutil", [
        "--get",
        "ComputerName",
      ]);

      return stdout.trim();
    } catch {
      return "Mac";
    }
  }

  private async getMemoryBytes(): Promise<number> {
    try {
      const { stdout } = await execFileAsync("sysctl", ["-n", "hw.memsize"]);

      const memoryBytes = Number(stdout.trim());

      return Number.isFinite(memoryBytes) ? memoryBytes : 0;
    } catch {
      return 0;
    }
  }

  private async getAvailableDiskBytes(): Promise<number> {
    try {
      const { stdout } = await execFileAsync("df", ["-k", "/"]);

      const lines = stdout.trim().split("\n");

      if (lines.length < 2) {
        return 0;
      }

      const parts = lines[1].trim().split(/\s+/);

      if (parts.length < 4) {
        return 0;
      }

      const availableKilobytes = Number(parts[3]);

      if (!Number.isFinite(availableKilobytes)) {
        return 0;
      }

      return availableKilobytes * 1024;
    } catch {
      return 0;
    }
  }

  private async commandExists(command: string): Promise<boolean> {
    try {
      await execFileAsync("which", [command]);
      return true;
    } catch {
      return false;
    }
  }

  private async detectRosetta(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("pgrep", ["oahd"]);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
}
