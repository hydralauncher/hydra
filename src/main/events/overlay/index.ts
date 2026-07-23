import { OverlayManager } from "@main/services/overlay-manager";
import { levelKeys, overlayNotesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

registerEvent("getOverlayContext", () => OverlayManager.getContext());
registerEvent("closeHydraOverlay", () => OverlayManager.hideOverlay());
registerEvent("setOverlayPerformancePinned", (_event, pinned: boolean) =>
  OverlayManager.setPerformancePinned(Boolean(pinned))
);
registerEvent("getOverlayNote", async () => {
  const game = OverlayManager.getActiveGame();
  if (!game) return "";
  return (
    (await overlayNotesSublevel.get(
      levelKeys.game(game.shop, game.objectId)
    )) ?? ""
  );
});
registerEvent("saveOverlayNote", async (_event, note: string) => {
  const game = OverlayManager.getActiveGame();
  if (!game) return;
  await overlayNotesSublevel.put(
    levelKeys.game(game.shop, game.objectId),
    String(note).slice(0, 20_000)
  );
});
