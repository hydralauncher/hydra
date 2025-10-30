import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import axios from "axios";
import sudo from "sudo-prompt";
import { app } from "electron";
import {
  HYDRA_DECKY_PLUGIN_LOCATION,
  DECKY_PLUGINS_LOCATION,
} from "@main/constants";
import { logger } from "./logger";
import { SevenZip } from "./7zip";
import { SystemPath } from "./system-path";
import { HydraApi } from "./hydra-api";

interface DeckyReleaseInfo {
  version: string;
  downloadUrl: string;
}

export class DeckyPlugin {
  private static releaseInfo: DeckyReleaseInfo | null = null;

  private static async getDeckyReleaseInfo(): Promise<DeckyReleaseInfo> {
    if (this.releaseInfo) {
      return this.releaseInfo;
    }

    try {
      const response = await HydraApi.get<DeckyReleaseInfo>(
        "/decky/release",
        {},
        { needsAuth: false }
      );

      this.releaseInfo = response;
      return response;
    } catch (error) {
      logger.error("Failed to fetch Decky release info:", error);
      throw error;
    }
  }

  private static getPackageJsonPath(): string {
    return path.join(HYDRA_DECKY_PLUGIN_LOCATION, "package.json");
  }

  private static async downloadPlugin(): Promise<string> {
    logger.log("Downloading Hydra Decky plugin...");

    const releaseInfo = await this.getDeckyReleaseInfo();
    const tempDir = SystemPath.getPath("temp");
    const zipPath = path.join(tempDir, "Hydra.zip");

    const response = await axios.get(releaseInfo.downloadUrl, {
      responseType: "arraybuffer",
    });

    await fs.promises.writeFile(zipPath, response.data);
    logger.log(`Plugin downloaded to: ${zipPath}`);

    return zipPath;
  }

  private static async extractPlugin(zipPath: string): Promise<string> {
    logger.log("Extracting Hydra Decky plugin...");

    const tempDir = SystemPath.getPath("temp");
    const extractPath = path.join(tempDir, "hydra-decky-plugin");

    if (fs.existsSync(extractPath)) {
      await fs.promises.rm(extractPath, { recursive: true, force: true });
    }

    await fs.promises.mkdir(extractPath, { recursive: true });

    return new Promise((resolve, reject) => {
      SevenZip.extractFile(
        {
          filePath: zipPath,
          outputPath: extractPath,
        },
        () => {
          logger.log(`Plugin extracted to: ${extractPath}`);
          resolve(extractPath);
        },
        () => {
          reject(new Error("Failed to extract plugin"));
        }
      );
    });
  }

  private static needsSudo(): boolean {
    try {
      if (fs.existsSync(DECKY_PLUGINS_LOCATION)) {
        fs.accessSync(DECKY_PLUGINS_LOCATION, fs.constants.W_OK);
        return false;
      }

      const parentDir = path.dirname(DECKY_PLUGINS_LOCATION);
      if (fs.existsSync(parentDir)) {
        fs.accessSync(parentDir, fs.constants.W_OK);
        return false;
      }

      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "EACCES" || error.code === "EPERM")
      ) {
        return true;
      }
      throw error;
    }
  }

  private static async installPluginWithSudo(
    extractPath: string
  ): Promise<void> {
    logger.log("Installing plugin with sudo...");

    const username = os.userInfo().username;
    const sourcePath = path.join(extractPath, "Hydra");

    return new Promise((resolve, reject) => {
      const command = `mkdir -p "${DECKY_PLUGINS_LOCATION}" && rm -rf "${HYDRA_DECKY_PLUGIN_LOCATION}" && cp -r "${sourcePath}" "${HYDRA_DECKY_PLUGIN_LOCATION}" && chown -R ${username}: "${DECKY_PLUGINS_LOCATION}"`;

      sudo.exec(
        command,
        { name: app.getName() },
        (sudoError, _stdout, stderr) => {
          if (sudoError) {
            logger.error("Failed to install plugin with sudo:", sudoError);
            reject(sudoError);
          } else {
            logger.log("Plugin installed successfully with sudo");
            if (stderr) {
              logger.log("Sudo stderr:", stderr);
            }
            resolve();
          }
        }
      );
    });
  }

  private static async installPluginWithoutSudo(
    extractPath: string
  ): Promise<void> {
    logger.log("Installing plugin without sudo...");

    const sourcePath = path.join(extractPath, "Hydra");

    if (!fs.existsSync(DECKY_PLUGINS_LOCATION)) {
      await fs.promises.mkdir(DECKY_PLUGINS_LOCATION, { recursive: true });
    }

    if (fs.existsSync(HYDRA_DECKY_PLUGIN_LOCATION)) {
      await fs.promises.rm(HYDRA_DECKY_PLUGIN_LOCATION, {
        recursive: true,
        force: true,
      });
    }

    await fs.promises.cp(sourcePath, HYDRA_DECKY_PLUGIN_LOCATION, {
      recursive: true,
    });

    logger.log("Plugin installed successfully");
  }

  private static async installPlugin(extractPath: string): Promise<void> {
    if (this.needsSudo()) {
      await this.installPluginWithSudo(extractPath);
    } else {
      await this.installPluginWithoutSudo(extractPath);
    }
  }

  private static async updatePlugin(): Promise<void> {
    let zipPath: string | null = null;
    let extractPath: string | null = null;

    try {
      zipPath = await this.downloadPlugin();
      extractPath = await this.extractPlugin(zipPath);
      await this.installPlugin(extractPath);

      logger.log("Plugin update completed successfully");
    } catch (error) {
      logger.error("Failed to update plugin:", error);
      throw error;
    } finally {
      if (zipPath) {
        try {
          await fs.promises.rm(zipPath, { force: true });
          logger.log("Cleaned up downloaded zip file");
        } catch (cleanupError) {
          logger.error("Failed to clean up zip file:", cleanupError);
        }
      }

      if (extractPath) {
        try {
          await fs.promises.rm(extractPath, { recursive: true, force: true });
          logger.log("Cleaned up extraction directory");
        } catch (cleanupError) {
          logger.error(
            "Failed to clean up extraction directory:",
            cleanupError
          );
        }
      }
    }
  }

  public static async checkAndUpdateIfOutdated(): Promise<void> {
    if (!fs.existsSync(HYDRA_DECKY_PLUGIN_LOCATION)) {
      logger.log("Hydra Decky plugin not installed, skipping update check");
      return;
    }

    const packageJsonPath = this.getPackageJsonPath();

    try {
      if (!fs.existsSync(packageJsonPath)) {
        logger.log(
          "Hydra Decky plugin package.json not found, skipping update"
        );
        return;
      }

      const releaseInfo = await this.getDeckyReleaseInfo();
      const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(packageJsonContent);
      const currentVersion = packageJson.version;
      const isOutdated = currentVersion !== releaseInfo.version;

      if (isOutdated) {
        logger.log(
          `Hydra Decky plugin is outdated. Current: ${currentVersion}, Expected: ${releaseInfo.version}. Updating...`
        );

        await this.updatePlugin();
        logger.log("Hydra Decky plugin updated successfully");
      } else {
        logger.log(`Hydra Decky plugin is up to date (${currentVersion})`);
      }
    } catch (error) {
      logger.error(`Error checking/updating Hydra Decky plugin: ${error}`);
    }
  }

  public static async checkPluginVersion(): Promise<{
    exists: boolean;
    outdated: boolean;
    currentVersion: string | null;
    expectedVersion: string;
  }> {
    try {
      const releaseInfo = await this.getDeckyReleaseInfo();

      if (!fs.existsSync(HYDRA_DECKY_PLUGIN_LOCATION)) {
        logger.log("Hydra Decky plugin folder not found, installing...");

        try {
          await this.updatePlugin();

          // Read the actual installed version from package.json
          const packageJsonPath = this.getPackageJsonPath();
          if (fs.existsSync(packageJsonPath)) {
            const packageJsonContent = fs.readFileSync(
              packageJsonPath,
              "utf-8"
            );
            const packageJson = JSON.parse(packageJsonContent);
            return {
              exists: true,
              outdated: false,
              currentVersion: packageJson.version,
              expectedVersion: releaseInfo.version,
            };
          }

          return {
            exists: true,
            outdated: false,
            currentVersion: releaseInfo.version,
            expectedVersion: releaseInfo.version,
          };
        } catch (error) {
          logger.error("Failed to install plugin:", error);
          return {
            exists: false,
            outdated: true,
            currentVersion: null,
            expectedVersion: releaseInfo.version,
          };
        }
      }

      const packageJsonPath = this.getPackageJsonPath();

      try {
        if (!fs.existsSync(packageJsonPath)) {
          logger.log(
            "Hydra Decky plugin package.json not found, installing..."
          );

          await this.updatePlugin();

          // Read the actual installed version from package.json
          if (fs.existsSync(packageJsonPath)) {
            const packageJsonContent = fs.readFileSync(
              packageJsonPath,
              "utf-8"
            );
            const packageJson = JSON.parse(packageJsonContent);
            return {
              exists: true,
              outdated: false,
              currentVersion: packageJson.version,
              expectedVersion: releaseInfo.version,
            };
          }

          return {
            exists: true,
            outdated: false,
            currentVersion: releaseInfo.version,
            expectedVersion: releaseInfo.version,
          };
        }

        const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
        const packageJson = JSON.parse(packageJsonContent);
        const currentVersion = packageJson.version;
        const isOutdated = currentVersion !== releaseInfo.version;

        if (isOutdated) {
          logger.log(
            `Hydra Decky plugin is outdated. Current: ${currentVersion}, Expected: ${releaseInfo.version}`
          );

          await this.updatePlugin();

          if (fs.existsSync(packageJsonPath)) {
            const updatedPackageJsonContent = fs.readFileSync(
              packageJsonPath,
              "utf-8"
            );
            const updatedPackageJson = JSON.parse(updatedPackageJsonContent);
            return {
              exists: true,
              outdated: false,
              currentVersion: updatedPackageJson.version,
              expectedVersion: releaseInfo.version,
            };
          }

          return {
            exists: true,
            outdated: false,
            currentVersion: releaseInfo.version,
            expectedVersion: releaseInfo.version,
          };
        } else {
          logger.log(`Hydra Decky plugin is up to date (${currentVersion})`);
        }

        return {
          exists: true,
          outdated: isOutdated,
          currentVersion,
          expectedVersion: releaseInfo.version,
        };
      } catch (error) {
        logger.error(`Error checking Hydra Decky plugin version: ${error}`);
        return {
          exists: false,
          outdated: true,
          currentVersion: null,
          expectedVersion: releaseInfo.version,
        };
      }
    } catch (error) {
      logger.error(`Error fetching release info: ${error}`);
      return {
        exists: false,
        outdated: true,
        currentVersion: null,
        expectedVersion: "unknown",
      };
    }
  }
}
