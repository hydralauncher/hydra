import { registerEvent } from "../register-event";
import { openClassicsGame } from "@main/helpers";
import type { GameShop } from "@types";

const openClassicsGameEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  discPath?: string,
  force?: boolean
) => openClassicsGame(shop, objectId, discPath, force);

registerEvent("openClassicsGame", openClassicsGameEvent);
