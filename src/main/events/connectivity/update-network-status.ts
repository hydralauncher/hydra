import { registerEvent } from "../register-event";
import { DownloadOrchestrator, groupedSouvenirWorker } from "@main/services";

const updateNetworkStatus = (
  _event: Electron.IpcMainInvokeEvent,
  payload: { online: boolean; switched?: boolean }
) => {
  DownloadOrchestrator.onNetworkStatusChanged(payload);
  if (payload.online) void groupedSouvenirWorker.trigger();
};

registerEvent("updateNetworkStatus", updateNetworkStatus);
