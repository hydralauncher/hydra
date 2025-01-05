import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const getFeatures = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.get<string[]>("/features", null, { needsAuth: false });
};

registerEvent("getFeatures", getFeatures);
