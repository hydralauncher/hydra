import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

const isUserLoggedIn = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.isLoggedIn();
};

registerEvent("isUserLoggedIn", isUserLoggedIn);
