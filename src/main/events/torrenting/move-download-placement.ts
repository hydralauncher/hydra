import { registerEvent } from "../register-event";
import { DownloadOrchestrator } from "../../services";
import type { GameShop } from "../../../types";

const moveDownloadPlacement = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  targetArea: "hero" | "queue" | "paused",
  targetIndex?: number
) => {
  return DownloadOrchestrator.moveDownloadPlacement(
    shop,
    objectId,
    targetArea,
    targetIndex
  );
};

registerEvent("moveDownloadPlacement", moveDownloadPlacement);
