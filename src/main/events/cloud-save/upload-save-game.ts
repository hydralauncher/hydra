import { CloudSync } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { runWithHydraSaveGuard } from "@main/services/epic/cloud-saves";

const uploadSaveGame = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  downloadOptionTitle: string | null
) => {
  return runWithHydraSaveGuard(() =>
    CloudSync.uploadSaveGame(
      objectId,
      shop,
      downloadOptionTitle,
      CloudSync.getBackupLabel(false)
    )
  );
};

registerEvent("uploadSaveGame", uploadSaveGame);
