import { shell } from "electron";
import { spawn } from "node:child_process";
import { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { WindowManager, logger } from "@main/services";
import { CommonRedistManager } from "@main/services/common-redist-manager";
import { parseExecutablePath } from "../events/helpers/parse-executable-path";
import { parseLaunchOptions } from "../events/helpers/parse-launch-options";

export interface LaunchGameOptions {
  shop: GameShop;
  objectId: string;
  executablePath: string;
  launchOptions?: string | null;
}

/**
 * Shows the launcher window and launches the game executable
 * Shared between deep link handler and openGame event
 */
export const launchGame = async (options: LaunchGameOptions): Promise<void> => {
  const { shop, objectId, executablePath, launchOptions } = options;

  const parsedPath = parseExecutablePath(executablePath);
  const parsedParams = parseLaunchOptions(launchOptions);

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      executablePath: parsedPath,
      launchOptions,
    });
  }

  await WindowManager.createGameLauncherWindow(shop, objectId);

  // Run preflight check for common redistributables (Windows only)
  // Wrapped in try/catch to ensure game launch is never blocked
  if (process.platform === "win32") {
    try {
      logger.log("Starting preflight check for game launch", {
        shop,
        objectId,
      });
      const preflightPassed = await CommonRedistManager.runPreflight();
      logger.log("Preflight check result", { passed: preflightPassed });
    } catch (error) {
      logger.error(
        "Preflight check failed with error, continuing with launch",
        error
      );
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (parsedParams.length === 0) {
    shell.openPath(parsedPath);
    return;
  }

  spawn(parsedPath, parsedParams, { shell: false, detached: true });
};
