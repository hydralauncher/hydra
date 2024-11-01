import { TorBoxClient } from "@main/services/torbox";
import { registerEvent } from "../register-event";

const authenticateTorBox = async (
  _event: Electron.IpcMainInvokeEvent,
  apiToken: string
) => {
  TorBoxClient.authorize(apiToken);

  return TorBoxClient.getUser();
};

registerEvent("authenticateTorBox", authenticateTorBox);
