import type { CatalogueSearchPayload } from "@types";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const PAGE_SIZE = 12;

const searchGames = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: CatalogueSearchPayload,
  page: number
) => {
  return HydraApi.post(
    "/catalogue/search",
    { ...payload, take: page * PAGE_SIZE, skip: (page - 1) * PAGE_SIZE },
    { needsAuth: false }
  );
};

registerEvent("searchGames", searchGames);
