import { isSteamAppExecutable } from "@main/services/steam-integration/steam-library-executable";

import { registerEvent } from "../register-event";

const isSteamAppExecutableEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  appId: string,
  executablePath: string
) => isSteamAppExecutable(appId, executablePath);

registerEvent("isSteamAppExecutable", isSteamAppExecutableEvent);
