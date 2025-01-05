import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { CatalogueCategory } from "@shared";

const getCatalogue = async (
  _event: Electron.IpcMainInvokeEvent,
  category: CatalogueCategory
) => {
  const params = new URLSearchParams({
    take: "12",
    skip: "0",
  });

  return HydraApi.get(
    `/catalogue/${category}?${params.toString()}`,
    {},
    { needsAuth: false }
  );
};

registerEvent("getCatalogue", getCatalogue);
