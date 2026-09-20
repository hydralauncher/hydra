import { registerEvent } from "../register-event";
import { openClassicsGame } from "@main/helpers";
import type { GameShop, LaunchSource } from "@types";

const openClassicsGameEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  discPath?: string,
  force?: boolean,
  launchSource: LaunchSource = "default"
) => openClassicsGame(shop, objectId, discPath, force, launchSource);

registerEvent("openClassicsGame", openClassicsGameEvent);
