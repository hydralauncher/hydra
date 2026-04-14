import { registerEvent } from "../register-event";
import { NativeAddon } from "@main/services/native-addon";

const processProfileImageEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  path: string
) => {
  return processProfileImage(path, "webp");
};

export const processProfileImage = async (path: string, extension?: string) => {
  return NativeAddon.processProfileImage(path, extension);
};

registerEvent("processProfileImage", processProfileImageEvent);
