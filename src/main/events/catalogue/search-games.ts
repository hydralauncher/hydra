import type { CatalogueSearchPayload } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const searchGames = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: CatalogueSearchPayload
) => {
  return HydraApi.post(
    "/catalogue/search",
    { ...payload, take: 12, skip: 0 },
    { needsAuth: false }
  );
};

registerEvent("searchGames", searchGames);
