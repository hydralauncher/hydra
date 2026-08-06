import { OverlayManager } from "@main/services/overlay-manager";
import { levelKeys, overlayNotesSublevel } from "@main/level";
import { registerEvent } from "../register-event";
import type { GameShop } from "@types";

const isActiveGame = (shop: GameShop, objectId: string) => {
  const game = OverlayManager.getActiveGame();
  return game?.shop === shop && game.objectId === objectId;
};

registerEvent("getOverlayContext", () => OverlayManager.getContext());
registerEvent("closeHydraOverlay", () => OverlayManager.hideOverlay());
registerEvent("setOverlayPerformancePinned", (_event, pinned: boolean) =>
  OverlayManager.setPerformancePinned(Boolean(pinned))
);
registerEvent(
  "getOverlayNote",
  async (_event, shop: GameShop, objectId: string) => {
    if (!isActiveGame(shop, objectId)) return null;
    return (
      (await overlayNotesSublevel.get(levelKeys.game(shop, objectId))) ?? ""
    );
  }
);
registerEvent(
  "saveOverlayNote",
  async (_event, shop: GameShop, objectId: string, note: string) => {
    if (!isActiveGame(shop, objectId)) return false;
    await overlayNotesSublevel.put(
      levelKeys.game(shop, objectId),
      String(note).slice(0, 20_000)
    );
    return true;
  }
);
