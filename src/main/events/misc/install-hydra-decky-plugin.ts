import { registerEvent } from "../register-event";
import { logger, DeckyPlugin } from "@main/services";
import { HYDRA_DECKY_PLUGIN_LOCATION } from "@main/constants";

const installHydraDeckyPlugin = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{
  success: boolean;
  path: string;
  currentVersion: string | null;
  expectedVersion: string;
  error?: string;
}> => {
  try {
    logger.log("Installing/updating Hydra Decky plugin...");

    const result = await DeckyPlugin.checkPluginVersion();

    if (result.exists && !result.outdated) {
      logger.log("Plugin installed successfully");
      return {
        success: true,
        path: HYDRA_DECKY_PLUGIN_LOCATION,
        currentVersion: result.currentVersion,
        expectedVersion: result.expectedVersion,
      };
    } else {
      logger.error("Failed to install plugin");
      return {
        success: false,
        path: HYDRA_DECKY_PLUGIN_LOCATION,
        currentVersion: result.currentVersion,
        expectedVersion: result.expectedVersion,
        error: "Plugin installation failed",
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to install plugin:", error);
    return {
      success: false,
      path: HYDRA_DECKY_PLUGIN_LOCATION,
      currentVersion: null,
      expectedVersion: "0.0.3",
      error: errorMessage,
    };
  }
};

registerEvent("installHydraDeckyPlugin", installHydraDeckyPlugin);
