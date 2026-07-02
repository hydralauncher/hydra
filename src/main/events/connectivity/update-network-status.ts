import { registerEvent } from "../register-event";
import { DownloadOrchestrator } from "@main/services";

const updateNetworkStatus = (
  _event: Electron.IpcMainInvokeEvent,
  payload: { online: boolean; switched?: boolean }
) => {
  DownloadOrchestrator.onNetworkStatusChanged(payload);
};

registerEvent("updateNetworkStatus", updateNetworkStatus);
