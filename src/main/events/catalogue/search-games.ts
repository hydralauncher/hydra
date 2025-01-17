import type { CatalogueSearchPayload } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const searchGames = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: CatalogueSearchPayload,
  take: number,
  skip: number
) => {
  return HydraApi.post(
    "/catalogue/search",
    { ...payload, take, skip },
    { needsAuth: false }
  );
};

registerEvent("searchGames", searchGames);
