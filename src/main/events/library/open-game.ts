import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { launchGame } from "@main/helpers";

const openGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null
) => {
  await launchGame({ shop, objectId, executablePath, launchOptions });
};

registerEvent("openGame", openGame);
