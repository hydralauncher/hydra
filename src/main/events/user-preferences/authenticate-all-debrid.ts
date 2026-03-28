import { registerEvent } from "../register-event";
import { AllDebridClient } from "@main/services/download/all-debrid";

const authenticateAllDebrid = async (
  _event: Electron.IpcMainInvokeEvent,
  apiToken: string
) => {
  AllDebridClient.authorize(apiToken);

  const user = await AllDebridClient.getUser();
  return user;
};

registerEvent("authenticateAllDebrid", authenticateAllDebrid);
