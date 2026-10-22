import { shell } from "electron";
import { isValidSteamAppId } from "@shared";
import { watchSteamAppInstall } from "./steam-install-watcher";

export type SteamAppAction = "install" | "uninstall";

export const openSteamAppAction = async (
  action: SteamAppAction,
  steamAppId: string
) => {
  if (!isValidSteamAppId(steamAppId)) return;

  await shell.openExternal(`steam://${action}/${steamAppId}`);
  await watchSteamAppInstall(steamAppId);
};
