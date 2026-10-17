import { shell } from "electron";
import { watchSteamAppInstall } from "@main/services/steam-integration/steam-install-watcher";

import { registerEvent } from "../register-event";

const STEAM_APP_ID_PATTERN = /^[1-9]\d{0,9}$/;

const installGameOnSteam = async (
  _event: Electron.IpcMainInvokeEvent,
  steamAppId: string
) => {
  if (!STEAM_APP_ID_PATTERN.test(steamAppId)) return;

  await shell.openExternal(`steam://install/${steamAppId}`);
  await watchSteamAppInstall(steamAppId);
};

registerEvent("installGameOnSteam", installGameOnSteam);
