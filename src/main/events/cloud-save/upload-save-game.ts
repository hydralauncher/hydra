import { CloudSync } from "@main/services";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import i18next, { t } from "i18next";
import { formatDate } from "date-fns";

const uploadSaveGame = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  downloadOptionTitle: string | null
) => {
  const { language } = i18next;

  return CloudSync.uploadSaveGame(
    objectId,
    shop,
    downloadOptionTitle,
    t("backup_from", {
      ns: "game_details",
      date: formatDate(new Date(), language),
    })
  );
};

registerEvent("uploadSaveGame", uploadSaveGame);
