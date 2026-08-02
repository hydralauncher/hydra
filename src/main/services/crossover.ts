import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { SystemPath } from "./system-path";
import { logger } from "./logger";

const CROSSOVER_APP_PATH = "/Applications/CrossOver.app";
const CROSSOVER_BOTTLES_DIR = path.join(
  SystemPath.getPath("home"),
  "Library",
  "Application Support",
  "CrossOver",
  "Bottles"
);

const DEFAULT_BOTTLE_NAME = "Hydra";

export interface CrossOverBottle {
  name: string;
  path: string;
  isDefault: boolean;
}

export class CrossOver {
  /**
   * Check if CrossOver.app is installed in /Applications
   */
  public static isInstalled(): boolean {
    return fs.existsSync(CROSSOVER_APP_PATH);
  }

  /**
   * Get the CrossOver.app path
   */
  public static getAppPath(): string {
    return CROSSOVER_APP_PATH;
  }

  /**
   * Get CrossOver version from the app bundle's Info.plist
   */
  public static getVersion(): string | null {
    try {
      const plistPath = path.join(
        CROSSOVER_APP_PATH,
        "Contents",
        "Info.plist"
      );
      if (!fs.existsSync(plistPath)) return null;

      const result = spawnSync("defaults", ["read", plistPath, "CFBundleShortVersionString"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });

      if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get the path where CrossOver stores bottles
   */
  public static getBottlesDirectory(): string {
    return CROSSOVER_BOTTLES_DIR;
  }

  /**
   * List all CrossOver bottles
   */
  public static listBottles(): CrossOverBottle[] {
    if (!fs.existsSync(CROSSOVER_BOTTLES_DIR)) {
      return [];
    }

    try {
      const entries = fs.readdirSync(CROSSOVER_BOTTLES_DIR, {
        withFileTypes: true,
      });

      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          name: entry.name,
          path: path.join(CROSSOVER_BOTTLES_DIR, entry.name),
          isDefault: entry.name === DEFAULT_BOTTLE_NAME,
        }))
        .sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return a.name.localeCompare(b.name);
        });
    } catch (error) {
      logger.error("Failed to list CrossOver bottles", error);
      return [];
    }
  }

  /**
   * Create a new CrossOver bottle
   */
  public static createBottle(name: string): CrossOverBottle | null {
    const bottlePath = path.join(CROSSOVER_BOTTLES_DIR, name);

    if (fs.existsSync(bottlePath)) {
      logger.warn(`Bottle "${name}" already exists`);
      return { name, path: bottlePath, isDefault: name === DEFAULT_BOTTLE_NAME };
    }

    try {
      // Create the bottle directory structure
      fs.mkdirSync(bottlePath, { recursive: true });

      // Use CrossOver's CLI to create a proper bottle if available
      const cxPath = path.join(
        CROSSOVER_APP_PATH,
        "Contents",
        "SharedSupport",
        "CrossOver",
        "bin",
        "cxrun"
      );

      if (fs.existsSync(cxPath)) {
        const result = spawnSync(cxPath, ["--bottle", name, "--create"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30000,
        });

        if (result.status === 0) {
          logger.info(`Created CrossOver bottle "${name}" via cxrun`);
          return { name, path: bottlePath, isDefault: name === DEFAULT_BOTTLE_NAME };
        }
      }

      // Fallback: create minimal bottle structure
      const driveCPath = path.join(bottlePath, "drive_c");
      fs.mkdirSync(driveCPath, { recursive: true });
      fs.mkdirSync(path.join(driveCPath, "windows"), { recursive: true });
      fs.mkdirSync(path.join(driveCPath, "Program Files"), { recursive: true });
      fs.mkdirSync(path.join(driveCPath, "Program Files (x86)"), { recursive: true });
      fs.mkdirSync(path.join(driveCPath, "users"), { recursive: true });

      logger.info(`Created CrossOver bottle "${name}" (manual structure)`);
      return { name, path: bottlePath, isDefault: name === DEFAULT_BOTTLE_NAME };
    } catch (error) {
      logger.error(`Failed to create CrossOver bottle "${name}"`, error);
      return null;
    }
  }

  /**
   * Get or create the default Hydra bottle
   */
  public static getDefaultBottle(): CrossOverBottle {
    const bottles = this.listBottles();
    const existing = bottles.find((b) => b.name === DEFAULT_BOTTLE_NAME);

    if (existing) {
      return existing;
    }

    return this.createBottle(DEFAULT_BOTTLE_NAME) ?? {
      name: DEFAULT_BOTTLE_NAME,
      path: path.join(CROSSOVER_BOTTLES_DIR, DEFAULT_BOTTLE_NAME),
      isDefault: true,
    };
  }

  /**
   * Get the path to a bottle by name
   */
  public static getBottlePath(name: string): string {
    return path.join(CROSSOVER_BOTTLES_DIR, name);
  }

  /**
   * Check if a bottle exists
   */
  public static bottleExists(name: string): boolean {
    return fs.existsSync(path.join(CROSSOVER_BOTTLES_DIR, name));
  }

  /**
   * Get the cxrun binary path inside CrossOver.app
   */
  private static getCxRunPath(): string | null {
    const cxrunPath = path.join(
      CROSSOVER_APP_PATH,
      "Contents",
      "SharedSupport",
      "CrossOver",
      "bin",
      "cxrun"
    );

    if (fs.existsSync(cxrunPath)) {
      return cxrunPath;
    }

    // Alternative location
    const altPath = path.join(
      CROSSOVER_APP_PATH,
      "Contents",
      "MacOS",
      "CrossOver"
    );

    if (fs.existsSync(altPath)) {
      return altPath;
    }

    return null;
  }

  /**
   * Launch an executable inside a CrossOver bottle
   */
  public static async launchInBottle(
    bottleName: string,
    executablePath: string,
    args: string[] = []
  ): Promise<void> {
    const bottlePath = this.getBottlePath(bottleName);

    if (!this.bottleExists(bottleName)) {
      this.createBottle(bottleName);
    }

    const cxrunPath = this.getCxRunPath();

    if (cxrunPath) {
      // Use cxrun if available
      return new Promise<void>((resolve, reject) => {
        const child = spawn(
          cxrunPath,
          ["--bottle", bottleName, executablePath, ...args],
          {
            detached: true,
            stdio: "ignore",
            shell: false,
            cwd: path.dirname(executablePath),
            env: {
              ...process.env,
              CROSSOVER_BOTTLE: bottleName,
              WINEPREFIX: bottlePath,
            },
          }
        );

        child.once("spawn", () => {
          child.unref();
          resolve();
        });

        child.once("error", (error) => {
          logger.error("Failed to launch with cxrun", error);
          reject(error);
        });
      });
    }

    // Fallback: use open -a CrossOver
    return new Promise<void>((resolve, reject) => {
      const child = spawn(
        "open",
        ["-a", "CrossOver", "--args", bottleName, executablePath, ...args],
        {
          detached: true,
          stdio: "ignore",
          shell: false,
          cwd: path.dirname(executablePath),
        }
      );

      child.once("spawn", () => {
        child.unref();
        resolve();
      });

      child.once("error", (error) => {
        logger.error("Failed to launch with CrossOver.app", error);
        reject(error);
      });
    });
  }

  /**
   * Run an installer inside a CrossOver bottle
   */
  public static async installInBottle(
    bottleName: string,
    installerPath: string,
    args: string[] = []
  ): Promise<void> {
    logger.info(`Running installer in CrossOver bottle`, {
      bottle: bottleName,
      installer: installerPath,
    });

    return this.launchInBottle(bottleName, installerPath, args);
  }

  /**
   * Copy game files into a CrossOver bottle's Program Files directory.
   * Returns the destination path inside the bottle.
   */
  public static copyGameToBottle(
    bottleName: string,
    sourcePath: string,
    gameTitle: string
  ): string {
    if (!this.bottleExists(bottleName)) {
      this.createBottle(bottleName);
    }

    const bottlePath = this.getBottlePath(bottleName);
    const sanitizedName = gameTitle.replace(/[<>:"/\\|?*]/g, "_").trim() || "Game";
    const destinationPath = path.join(
      bottlePath,
      "drive_c",
      "Program Files",
      sanitizedName
    );

    fs.mkdirSync(destinationPath, { recursive: true });
    fs.cpSync(sourcePath, destinationPath, { recursive: true });

    logger.info(`Copied game files to CrossOver bottle`, {
      bottle: bottleName,
      source: sourcePath,
      destination: destinationPath,
    });

    return destinationPath;
  }

  /**
   * Find an executable inside a bottle's Program Files directory.
   * Looks for the exe with the same filename as the original executablePath
   * inside a folder matching the game title.
   */
  public static findExecutableInBottle(
    bottleName: string,
    gameTitle: string,
    originalExecutablePath: string
  ): string | null {
    try {
      const bottlePath = this.getBottlePath(bottleName);
      const sanitizedName = gameTitle.replace(/[<>:"/\\|?*]/g, "_").trim() || "Game";
      const gameDir = path.join(
        bottlePath,
        "drive_c",
        "Program Files",
        sanitizedName
      );

      if (!fs.existsSync(gameDir)) return null;

      const exeName = path.basename(originalExecutablePath);
      const candidate = path.join(gameDir, exeName);

      if (fs.existsSync(candidate)) return candidate;

      // Fallback: search for any matching exe filename recursively
      const entries = fs.readdirSync(gameDir, {
        withFileTypes: true,
        recursive: true,
      });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === exeName.toLowerCase()) {
          const parentPath =
            "parentPath" in entry
              ? entry.parentPath
              : (entry as unknown as { path?: string }).path || gameDir;
          return path.join(parentPath, entry.name);
        }
      }
    } catch {
      // Silently fail
    }
    return null;
  }

  /**
   * Detect CrossOver and return its info
   */
  public static detect(): {
    installed: boolean;
    version: string | null;
    appPath: string;
    bottlesDirectory: string;
    bottles: CrossOverBottle[];
  } {
    const installed = this.isInstalled();
    const version = installed ? this.getVersion() : null;
    const bottles = installed ? this.listBottles() : [];

    return {
      installed,
      version,
      appPath: CROSSOVER_APP_PATH,
      bottlesDirectory: CROSSOVER_BOTTLES_DIR,
      bottles,
    };
  }
}
