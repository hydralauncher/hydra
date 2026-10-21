import { shell } from "electron";
import { watchSteamAppInstall } from "./steam-install-watcher";

const STEAM_APP_ID_PATTERN = /^[1-9]\d{0,9}$/;

export type SteamAppAction = "install" | "uninstall";

export const openSteamAppAction = async (
  action: SteamAppAction,
  steamAppId: string
) => {
  if (!STEAM_APP_ID_PATTERN.test(steamAppId)) return;

  await shell.openExternal(`steam://${action}/${steamAppId}`);
  await watchSteamAppInstall(steamAppId);
};
