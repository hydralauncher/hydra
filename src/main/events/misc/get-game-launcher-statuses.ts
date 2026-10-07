import type { GameShop } from "@types";
import { levelKeys } from "@main/level";
import { getGameLauncherStatuses } from "@main/services/game-launcher-status";
import { registerEvent } from "../register-event";

const getGameLauncherStatusesEvent = (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => getGameLauncherStatuses(levelKeys.game(shop, objectId));

registerEvent("getGameLauncherStatuses", getGameLauncherStatusesEvent);
