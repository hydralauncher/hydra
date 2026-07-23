import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const getRetroArchConfig = async (_event: Electron.IpcMainInvokeEvent) =>
  retroarch.getRetroArchConfig();

registerEvent("getRetroArchConfig", getRetroArchConfig);
