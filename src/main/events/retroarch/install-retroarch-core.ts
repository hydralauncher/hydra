import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";
import type { RetroArchCoreName } from "@types";

const installRetroArchCore = async (
  _event: Electron.IpcMainInvokeEvent,
  core: RetroArchCoreName
) => retroarch.downloadAndInstallCore(core);

registerEvent("installRetroArchCore", installRetroArchCore);
