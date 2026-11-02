import { openSteamAppAction } from "@main/services/steam-integration/steam-app-action";

import { registerEvent } from "../register-event";

const uninstallGameOnSteam = async (
  _event: Electron.IpcMainInvokeEvent,
  steamAppId: string
) => {
  await openSteamAppAction("uninstall", steamAppId);
};

registerEvent("uninstallGameOnSteam", uninstallGameOnSteam);
