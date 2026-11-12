import { registerEvent } from "../register-event";
import { removeLibraryGame } from "@main/helpers/remove-library-game";
import type { GameShop } from "@types";

const removeGameFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => removeLibraryGame(shop, objectId);

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
