import type { GameShop } from "@types";

import { WindowManager } from "./window-manager";

export const notifyLibraryGameUpdated = (shop: GameShop, objectId: string) => {
  WindowManager.sendToAppWindows("on-library-game-updated", shop, objectId);
};
