import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import { HYDRA_DECKY_PLUGIN_LOCATION } from "@main/constants";
import fs from "node:fs";
import path from "node:path";

const getHydraDeckyPluginInfo = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{
  installed: boolean;
  version: string | null;
  path: string;
}> => {
  try {
    // Check if plugin folder exists
    if (!fs.existsSync(HYDRA_DECKY_PLUGIN_LOCATION)) {
      logger.log("Hydra Decky plugin not installed");
      return {
        installed: false,
        version: null,
        path: HYDRA_DECKY_PLUGIN_LOCATION,
      };
    }

    // Check if package.json exists
    const packageJsonPath = path.join(
      HYDRA_DECKY_PLUGIN_LOCATION,
      "package.json"
    );

    if (!fs.existsSync(packageJsonPath)) {
      logger.log("Hydra Decky plugin package.json not found");
      return {
        installed: false,
        version: null,
        path: HYDRA_DECKY_PLUGIN_LOCATION,
      };
    }

    // Read and parse package.json
    const packageJsonContent = fs.readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    const version = packageJson.version;

    logger.log(`Hydra Decky plugin installed, version: ${version}`);

    return {
      installed: true,
      version,
      path: HYDRA_DECKY_PLUGIN_LOCATION,
    };
  } catch (error) {
    logger.error("Failed to get plugin info:", error);
    return {
      installed: false,
      version: null,
      path: HYDRA_DECKY_PLUGIN_LOCATION,
    };
  }
};

registerEvent("getHydraDeckyPluginInfo", getHydraDeckyPluginInfo);

