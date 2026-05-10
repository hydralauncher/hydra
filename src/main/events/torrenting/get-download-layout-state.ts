import { registerEvent } from "../register-event";
import { DownloadOrchestrator } from "@main/services";

const getDownloadLayoutState = async () => {
  return DownloadOrchestrator.getLayoutState();
};

registerEvent("getDownloadLayoutState", getDownloadLayoutState);
