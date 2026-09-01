import { app } from "electron";
import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorBinary, EmulatorInstallPreviewPlatform } from "@types";

const PREVIEW_PLATFORMS = new Set<EmulatorInstallPreviewPlatform>([
  "win32",
  "linux",
  "darwin",
]);

const getEmulatorInstallOptions = async (
  _event: Electron.IpcMainInvokeEvent,
  binary: EmulatorBinary,
  requestedPlatform?: EmulatorInstallPreviewPlatform
) => {
  const previewPlatform =
    !app.isPackaged &&
    requestedPlatform &&
    PREVIEW_PLATFORMS.has(requestedPlatform)
      ? requestedPlatform
      : undefined;

  return emulators.resolveEmulatorInstallOptions(binary, previewPlatform);
};

registerEvent("getEmulatorInstallOptions", getEmulatorInstallOptions);
