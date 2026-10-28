import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import { findDownloadInstaller } from "@main/helpers/find-game-installer";
import { GameShop } from "@types";

const hasGameInstaller = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  if (shop === "launchbox") return false;

  const download = await downloadsSublevel.get(levelKeys.game(shop, objectId));

  return (await findDownloadInstaller(download)) !== null;
};

registerEvent("hasGameInstaller", hasGameInstaller);
