import { registerEvent } from "../register-event";
import { gamesSgdbSelectionSublevel, levelKeys } from "@main/level";
import { matchGame, WindowManager } from "@main/services";
import type { GameShop, SgdbOverride, SgdbSelectionRecord } from "@types";

const setSteamGridDbOverride = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  override: SgdbOverride
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const existing = await gamesSgdbSelectionSublevel.get(gameKey);

  const record: SgdbSelectionRecord = {
    objectId,
    shop,
    sgdbGameId: existing?.sgdbGameId ?? null,
    override,
    selected: existing?.selected ?? {},
    updatedAt: Date.now(),
  };

  await gamesSgdbSelectionSublevel.put(gameKey, record);

  if (override === "on") {
    await matchGame(shop, objectId, {}).catch(() => {});
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");

  return record;
};

registerEvent("setSteamGridDbOverride", setSteamGridDbOverride);
