import { RealDebridClient } from "@main/services/download/real-debrid";
import { registerEvent } from "../register-event";

const authenticateRealDebrid = async (
  _event: Electron.IpcMainInvokeEvent,
  apiToken: string
) => {
  RealDebridClient.authorize(apiToken);

  const user = await RealDebridClient.getUser();
  return user;
};

registerEvent("authenticateRealDebrid", authenticateRealDebrid);
