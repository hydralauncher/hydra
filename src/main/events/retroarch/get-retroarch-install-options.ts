import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const getRetroArchInstallOptions = async (
  _event: Electron.IpcMainInvokeEvent
) => retroarch.resolveRetroArchInstallOptions();

registerEvent("getRetroArchInstallOptions", getRetroArchInstallOptions);
