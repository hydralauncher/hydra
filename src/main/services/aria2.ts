import path from "node:path";
import cp from "node:child_process";
import fs from "node:fs";
import { app } from "electron";
import { logger } from "./logger";

export class Aria2 {
  private static process: cp.ChildProcess | null = null;

  private static async findSystemAria2OnMacOS(): Promise<string | null> {
    const possiblePaths = [
      "/opt/homebrew/bin/aria2c", // Homebrew on Apple Silicon
      "/usr/local/bin/aria2c", // Homebrew on Intel
      "/usr/bin/aria2c", // System installation
    ];

    try {
      const { execSync } = await import("node:child_process");
      const env = {
        ...process.env,
        PATH: `${process.env.PATH || ""}:/opt/homebrew/bin:/usr/local/bin:/usr/bin`,
      };
      const systemAria2 = execSync("which aria2c", {
        encoding: "utf-8",
        env,
      }).trim();
      if (systemAria2 && fs.existsSync(systemAria2)) {
        logger.log(`Found system aria2c at: ${systemAria2}`);
        return systemAria2;
      }
    } catch {
      // 'which' command failed, continue to direct path checks
    }

    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        logger.log(`Found system aria2c at: ${testPath}`);
        return testPath;
      }
    }

    return null;
  }

  private static async checkBundledBinaryCompatibility(
    binaryPath: string
  ): Promise<boolean> {
    if (process.platform !== "darwin") {
      return true;
    }

    try {
      const { execSync } = await import("node:child_process");
      const fileOutput = execSync(`file "${binaryPath}"`, {
        encoding: "utf-8",
      });
      if (fileOutput.includes("Linux") && !fileOutput.includes("Mach-O")) {
        logger.warn(
          `Bundled aria2c binary is for Linux, not macOS. Please install aria2 via Homebrew: brew install aria2`
        );
        return false;
      }
    } catch {
      // file command might not be available, continue anyway
    }

    return true;
  }

  private static async findAria2Binary(): Promise<string | null> {
    // On macOS, try to find system aria2 first (might be installed via Homebrew)
    if (process.platform === "darwin") {
      const systemAria2 = await this.findSystemAria2OnMacOS();
      if (systemAria2) {
        return systemAria2;
      }
    }

    // Try bundled binary
    const binaryPath = app.isPackaged
      ? path.join(process.resourcesPath, "aria2c")
      : path.join(__dirname, "..", "..", "binaries", "aria2c");

    if (fs.existsSync(binaryPath)) {
      const isCompatible =
        await this.checkBundledBinaryCompatibility(binaryPath);
      if (!isCompatible) {
        return null;
      }
      return binaryPath;
    }

    return null;
  }

  public static async spawn() {
    const binaryPath = await this.findAria2Binary();

    if (!binaryPath) {
      logger.error(
        `Aria2 binary not found. For macOS, please install aria2: brew install aria2`
      );
      return;
    }

    // Ensure binary has execute permissions on macOS/Linux
    if (process.platform !== "win32") {
      try {
        // 0o755 is safe: owner rwx, group/others rx (standard executable permissions)
        fs.chmodSync(binaryPath, 0o755); // NOSONAR
      } catch (error) {
        logger.warn(
          `Failed to set execute permissions on aria2 binary: ${error}`
        );
      }
    }

    logger.log(`Spawning aria2 from: ${binaryPath}`);

    try {
      // Set up environment for packaged apps to find aria2 dependencies if needed
      const env = { ...process.env };
      if (process.platform === "darwin" && app.isPackaged) {
        // Ensure Homebrew paths are in PATH for packaged apps
        const homebrewPaths = [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
        ];
        env.PATH = `${homebrewPaths.join(":")}:${env.PATH || ""}`;
      }

      this.process = cp.spawn(
        binaryPath,
        [
          "--enable-rpc",
          "--rpc-listen-all",
          "--rpc-listen-port=6800",
          "--file-allocation=none",
          "--allow-overwrite=true",
        ],
        {
          stdio: "inherit",
          windowsHide: true,
          env,
        }
      );

      this.process.on("error", (error) => {
        logger.error("Aria2 process error:", error);
        if (
          error.message.includes("ENOEXEC") &&
          process.platform === "darwin"
        ) {
          logger.error(
            "Aria2 binary is not compatible with macOS. Please install aria2: brew install aria2"
          );
        }
        this.process = null;
      });

      this.process.on("exit", (code, signal) => {
        if (code !== 0 && code !== null) {
          logger.error(
            `Aria2 process exited with code ${code} and signal ${signal}`
          );
        }
        this.process = null;
      });
    } catch (error) {
      logger.error("Failed to spawn aria2:", error);
      this.process = null;
    }
  }

  public static kill() {
    if (this.process) {
      logger.log("Killing aria2 process");
      this.process.kill();
    }
  }
}
