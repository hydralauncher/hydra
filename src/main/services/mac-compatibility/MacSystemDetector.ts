import { execFile } from "child_process";
import { promisify } from "util";
import { access, constants } from "node:fs/promises";
import type { MacArchitecture, MacSystemInfo } from "./MacCompatibilityTypes";

const execFileAsync = promisify(execFile);

/**
 * No detection command may hang the app. Every probe here is a tiny
 * system query, so a few seconds is already generous.
 */
const COMMAND_TIMEOUT_MS = 10_000;

/**
 * Runs a command and returns stdout. Injectable so the detection logic
 * can be tested without a real Mac.
 */
export type MacCommandRunner = (
  file: string,
  args: string[],
) => Promise<string>;

const defaultCommandRunner: MacCommandRunner = async (file, args) => {
  const { stdout } = await execFileAsync(file, args, {
    timeout: COMMAND_TIMEOUT_MS,
  });

  return stdout;
};

/**
 * Rosetta 2 installs these. Their presence is what "Rosetta is
 * available" actually means — unlike a running oahd process, which only
 * exists while something is being translated right now.
 */
const ROSETTA_INSTALL_PATHS = [
  "/Library/Apple/usr/libexec/oah",
  "/Library/Apple/usr/share/rosetta",
  "/usr/libexec/rosetta/oahd",
];

/**
 * Wine is usually installed by Homebrew or CrossOver. A Finder-launched
 * Electron app does not inherit a Terminal's PATH, so `which wine`
 * alone under-reports; these absolute locations are checked too.
 */
const WINE_PROBE_PATHS = [
  "/opt/homebrew/bin/wine64",
  "/opt/homebrew/bin/wine",
  "/usr/local/bin/wine64",
  "/usr/local/bin/wine",
  "/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine",
];

export class MacSystemDetector {
  private readonly run: MacCommandRunner;

  constructor(commandRunner: MacCommandRunner = defaultCommandRunner) {
    this.run = commandRunner;
  }

  async detect(): Promise<MacSystemInfo> {
    const architecture = await this.detectArchitecture();
    const isAppleSilicon = architecture === "arm64";

    const osVersion = await this.getMacOSVersion();
    const computerName = await this.getComputerName();
    const memoryBytes = await this.getMemoryBytes();
    const availableDiskBytes = await this.getAvailableDiskBytes();

    return {
      platform: "macos",
      architecture,
      osVersion,
      computerName,
      isAppleSilicon,
      isIntel: architecture === "x64",
      memoryBytes,
      availableDiskBytes,
      wineAvailable: await this.detectWine(),
      protonAvailable: await this.commandExists("proton"),
      rosettaAvailable: await this.detectRosetta(isAppleSilicon),
    };
  }

  /**
   * Reports the MACHINE's architecture, not the architecture this
   * process happens to be running as.
   *
   * `uname -m` answers the second question: when Hydra runs under
   * Rosetta 2 (an Intel build launched on an Apple Silicon Mac, which is
   * exactly what an x64 Electron build does) it prints "x86_64", so an
   * M-series Mac was being reported as Intel — and every Rosetta and
   * Wine recommendation derived from it was wrong.
   *
   * `sysctl hw.optional.arm64` is a hardware fact and is unaffected by
   * translation, so it is asked first. `uname -m` stays as the fallback
   * for the case where sysctl is unavailable.
   */
  private async detectArchitecture(): Promise<MacArchitecture> {
    const armFlag = await this.readSysctl("hw.optional.arm64");

    if (armFlag === "1") {
      return "arm64";
    }

    try {
      const output = await this.run("uname", ["-m"]);
      const machine = output.trim();

      if (machine === "arm64" || machine === "aarch64") {
        return "arm64";
      }

      if (machine === "x86_64") {
        // A translated process also prints x86_64, so double-check
        // before calling a Mac Intel.
        const translated = await this.isTranslated();

        return translated ? "arm64" : "x64";
      }

      return "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * True when this process is an Intel binary being translated by
   * Rosetta 2 on an Apple Silicon Mac.
   */
  private async isTranslated(): Promise<boolean> {
    return (await this.readSysctl("sysctl.proc_translated")) === "1";
  }

  private async readSysctl(key: string): Promise<string | null> {
    try {
      const output = await this.run("sysctl", ["-n", key]);
      const value = output.trim();

      return value === "" ? null : value;
    } catch {
      // sysctl exits non-zero for keys that don't exist — for example
      // hw.optional.arm64 on an Intel Mac.
      return null;
    }
  }

  /**
   * Rosetta 2 is an Apple Silicon-only feature.
   *
   * The old check ran `pgrep oahd`, which only finds the translation
   * daemon while it is actively translating something. On a Mac with
   * Rosetta installed but nothing being translated, that reported
   * "Rosetta not available", which is wrong. Installed files (and, as a
   * positive signal, this process itself being translated) are what
   * actually answer the question.
   */
  private async detectRosetta(isAppleSilicon: boolean): Promise<boolean> {
    if (!isAppleSilicon) {
      return false;
    }

    if (await this.isTranslated()) {
      return true;
    }

    for (const rosettaPath of ROSETTA_INSTALL_PATHS) {
      if (await this.pathExists(rosettaPath)) {
        return true;
      }
    }

    return false;
  }

  private async detectWine(): Promise<boolean> {
    for (const winePath of WINE_PROBE_PATHS) {
      if (await this.isExecutable(winePath)) {
        return true;
      }
    }

    return this.commandExists("wine");
  }

  private async getMacOSVersion(): Promise<string> {
    try {
      const output = await this.run("sw_vers", ["-productVersion"]);
      const version = output.trim();

      return version === "" ? "unknown" : version;
    } catch {
      return "unknown";
    }
  }

  private async getComputerName(): Promise<string> {
    try {
      const output = await this.run("scutil", ["--get", "ComputerName"]);
      const name = output.trim();

      return name === "" ? "Mac" : name;
    } catch {
      return "Mac";
    }
  }

  private async getMemoryBytes(): Promise<number> {
    const value = await this.readSysctl("hw.memsize");

    if (value === null) {
      return 0;
    }

    const memoryBytes = Number(value);

    return Number.isFinite(memoryBytes) && memoryBytes > 0 ? memoryBytes : 0;
  }

  private async getAvailableDiskBytes(): Promise<number> {
    try {
      const output = await this.run("df", ["-k", "/"]);

      const lines = output.trim().split("\n");

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
      const output = await this.run("which", [command]);

      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async isExecutable(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
}
