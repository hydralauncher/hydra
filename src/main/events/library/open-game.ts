import { registerEvent } from "../register-event";
import { shell } from "electron";
import { spawn } from "child_process";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import { parseLaunchOptions } from "../helpers/parse-launch-options";

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

  if (parsedParams.length === 0) {
    shell.openPath(parsedPath);
    return;
  }

  spawn(parsedPath, parsedParams, { shell: false, detached: true });
};

registerEvent("openGame", openGame);
