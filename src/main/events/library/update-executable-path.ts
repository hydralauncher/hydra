import { registerEvent } from "../register-event";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const updateExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string | null
) => {
  const parsedPath = executablePath
    ? parseExecutablePath(executablePath)
    : null;

  const gameKey = levelKeys.game(shop, objectId);

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    executablePath: parsedPath,
    automaticCloudSync:
      executablePath === null ? false : game.automaticCloudSync,
  });
};

registerEvent("updateExecutablePath", updateExecutablePath);
