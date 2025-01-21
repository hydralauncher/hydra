import { registerEvent } from "../register-event";
import { shell } from "electron";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { levelKeys } from "@main/level";
import { gamesSublevel } from "@main/level";
import { GameShop } from "@types";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null
) => {
  // TODO: revisit this for launchOptions
  const parsedPath = parseExecutablePath(executablePath);

  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    executablePath: parsedPath,
    launchOptions,
  });

  shell.openPath(parsedPath);
};

registerEvent("openGame", openGame);
