import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

const getPublishers = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.get<string[]>(`/catalogue/publishers`, null, {
    needsAuth: false,
  });
};

registerEvent("getPublishers", getPublishers);
