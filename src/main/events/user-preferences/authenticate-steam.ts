import { SteamAuthService } from "@main/services/steam-auth";
import { registerEvent } from "../register-event";

const authenticateSteam = async (_event: Electron.IpcMainInvokeEvent) => {
  const steamId = await SteamAuthService.openAuthWindow();
  return { steamId };
};

registerEvent("authenticateSteam", authenticateSteam);
