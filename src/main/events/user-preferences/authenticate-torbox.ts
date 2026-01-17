import { registerEvent } from "../register-event";
import { TorBoxClient } from "@main/services/download/torbox";

const authenticateTorBox = async (
  _event: Electron.IpcMainInvokeEvent,
  apiToken: string
) => {
  TorBoxClient.authorize(apiToken);

  const user = await TorBoxClient.getUser();
  return user;
};

registerEvent("authenticateTorBox", authenticateTorBox);
