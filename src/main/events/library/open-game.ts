import { registerEvent } from "../register-event";
import { GameShop, type LaunchSource } from "@types";
import { launchGame } from "@main/helpers";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null,
  launchSource: LaunchSource = "default"
) => {
  await launchGame({
    shop,
    objectId,
    executablePath,
    launchOptions,
    launchSource,
  });
};

registerEvent("openGame", openGame);
