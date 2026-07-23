import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const installRetroArch = async (
  _event: Electron.IpcMainInvokeEvent,
  optionId: string
) => retroarch.downloadAndInstallRetroArch(optionId);

registerEvent("installRetroArch", installRetroArch);
