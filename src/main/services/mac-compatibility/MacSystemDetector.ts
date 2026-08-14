import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";

const execFileAsync = promisify(execFile);

export interface MacSystemInfo {
  platform: "macos";
  architecture: "arm64" | "x64" | "unknown";
  osVersion: string;
  computerName: string;
  isAppleSilicon: boolean;
  isIntel: boolean;
  memoryBytes: number;
  availableDiskBytes: number;
  wineAvailable: boolean;
  protonAvailable: boolean;
  rosettaAvailable: boolean;
}

export class MacSystemDetector {
  public async detect(): Promise<MacSystemInfo> {
    const architecture = this.detectArchitecture();

    const [
      osVersion,
      computerName,
      availableDiskBytes,
      wineAvailable,
      protonAvailable,
      rosettaAvailable,
    ] = await Promise.all([
      this.getOsVersion(),
      this.getComputerName(),
      this.getAvailableDiskSpace(),
      this.commandExists("wine"),
      this.commandExists("proton"),
      this.detectRosetta(),
    ]);

    return {
      platform: "macos",
      architecture,
      osVersion,
      computerName,
      isAppleSilicon: architecture === "arm64",
      isIntel: architecture === "x64",
      memoryBytes: os.totalmem(),
      availableDiskBytes,
      wineAvailable,
      protonAvailable,
      rosettaAvailable,
    };
  }

  private detectArchitecture(): "arm64" | "x64" | "unknown" {
    const architecture = process.arch;

    if (architecture === "arm64") {
      return "arm64";
    }

    if (architecture === "x64") {
      return "x64";
    }

    return "unknown";
  }

  private async getOsVersion(): Promise<string> {
    try {
      const { stdout } = await execFileAsync("sw_vers", ["-productVersion"]);

      return stdout.trim();
    } catch {
      return os.release();
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
      return os.hostname();
    }
  }

  private async getAvailableDiskSpace(): Promise<number> {
    try {
      const { stdout } = await execFileAsync("df", ["-k", "/"]);

      const lines = stdout.trim().split("\n");

      if (lines.length < 2) {
        return 0;
      }

      const parts = lines[lines.length - 1].trim().split(/\s+/);

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
    if (this.detectArchitecture() !== "arm64") {
      return false;
    }

    try {
      await execFileAsync("/usr/bin/pgrep", ["oahd"]);

      return true;
    } catch {
      return false;
    }
  }
}
