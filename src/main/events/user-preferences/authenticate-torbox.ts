import { TorBoxClient } from "@main/services/torbox";
import { registerEvent } from "../register-event";

const authenticateTorBox = async (
  _event: Electron.IpcMainInvokeEvent,
  apiToken: string
) => {
  TorBoxClient.authorize(apiToken);

  const user = await TorBoxClient.getUser();
  return user;
};

registerEvent("authenticateTorBox", authenticateTorBox);
