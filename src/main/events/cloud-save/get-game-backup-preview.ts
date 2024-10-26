import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { Ludusavi } from "@main/services";
import { gameRepository } from "@main/repository";

const getGameBackupPreview = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
) => {
  const game = await gameRepository.findOne({
    where: {
      objectID: objectId,
      shop,
    },
  });

  return Ludusavi.getBackupPreview(shop, objectId, game?.winePrefixPath);
};

registerEvent("getGameBackupPreview", getGameBackupPreview);
