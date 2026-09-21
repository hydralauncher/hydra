import { registerEvent } from "../register-event";
import { GameShop } from "@types";
import { launchGame } from "@main/helpers";

const openGame = async (
  event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  executablePath: string,
  launchOptions?: string | null,
  skipSteamOverlayCheck?: boolean
) => {
  await launchGame({
    shop,
    objectId,
    executablePath,
    launchOptions,
    skipSteamOverlayCheck,
    requestingWebContents: event.sender,
  });
};

registerEvent("openGame", openGame);
