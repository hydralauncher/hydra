import { CloudSync } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { t } from "i18next";
import { format } from "date-fns";

const uploadSaveGame = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  downloadOptionTitle: string | null
) => {
  return CloudSync.uploadSaveGame(
    objectId,
    shop,
    downloadOptionTitle,
    t("backup_from", {
      ns: "game_details",
      date: format(new Date(), "dd/MM/yyyy"),
    })
  );
};

registerEvent("uploadSaveGame", uploadSaveGame);
