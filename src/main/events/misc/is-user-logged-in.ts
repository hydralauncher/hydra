import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";

const isUserLoggedIn = async (_event: Electron.IpcMainInvokeEvent) => {
  return HydraApi.isLoggedIn();
};

registerEvent("isUserLoggedIn", isUserLoggedIn);
