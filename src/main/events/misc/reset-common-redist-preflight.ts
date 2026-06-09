import { registerEvent } from "../register-event";
import { CommonRedistManager } from "@main/services/common-redist-manager";

const resetCommonRedistPreflight = async (
  _event: Electron.IpcMainInvokeEvent
) => CommonRedistManager.resetPreflightStatus();

registerEvent("resetCommonRedistPreflight", resetCommonRedistPreflight);
