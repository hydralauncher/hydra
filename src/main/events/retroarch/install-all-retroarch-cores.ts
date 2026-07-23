import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const installAllRetroArchCores = async (_event: Electron.IpcMainInvokeEvent) =>
  retroarch.downloadAndInstallAllCores();

registerEvent("installAllRetroArchCores", installAllRetroArchCores);
