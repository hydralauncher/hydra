import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

const getDevelopers = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.get<string[]>(`/catalogue/developers`, null, {
    needsAuth: false,
  });
};

registerEvent("getDevelopers", getDevelopers);
