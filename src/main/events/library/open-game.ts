import { registerEvent } from "../register-event";
import { shell } from "electron";
import { spawn } from "node:child_process";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import { parseLaunchOptions } from "../helpers/parse-launch-options";
import { WindowManager } from "@main/services";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null
) => {
  const parsedPath = parseExecutablePath(executablePath);
  const parsedParams = parseLaunchOptions(launchOptions);

  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    executablePath: parsedPath,
    launchOptions,
  });

  // Always show the launcher window when launching a game
  await WindowManager.createGameLauncherWindow(shop, objectId);

  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (parsedParams.length === 0) {
    shell.openPath(parsedPath);
    return;
  }

  spawn(parsedPath, parsedParams, { shell: false, detached: true });
};

registerEvent("openGame", openGame);
