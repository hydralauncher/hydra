import { shell } from "electron";
import { spawn } from "node:child_process";
import { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "@main/services";
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

  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (parsedParams.length === 0) {
    shell.openPath(parsedPath);
    return;
  }

  spawn(parsedPath, parsedParams, { shell: false, detached: true });
};
