import { openSteamAppAction } from "@main/services/steam-integration/steam-app-action";

import { registerEvent } from "../register-event";

const installGameOnSteam = async (
  _event: Electron.IpcMainInvokeEvent,
  steamAppId: string
) => {
  await openSteamAppAction("install", steamAppId);
};

registerEvent("installGameOnSteam", installGameOnSteam);
