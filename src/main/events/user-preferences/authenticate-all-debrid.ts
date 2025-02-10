import { AllDebridClient } from "@main/services/download/all-debrid";
import { registerEvent } from "../register-event";

const authenticateAllDebrid = async (
  _event: Electron.IpcMainInvokeEvent,
  apiKey: string
) => {
  AllDebridClient.authorize(apiKey);
  const result = await AllDebridClient.getUser();

  if ("error_code" in result) {
    return { error_code: result.error_code };
  }

  return result.user;
};

registerEvent("authenticateAllDebrid", authenticateAllDebrid);
