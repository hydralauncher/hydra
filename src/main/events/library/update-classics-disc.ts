import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import type { ClassicsDisc, GameShop } from "@types";

interface ClassicsDiscPatch {
  selectedDiscPath?: string | null;
  dontAskDiscSelection?: boolean;
  platform?: string | null;
  addDisc?: ClassicsDisc;
  removeDiscPath?: string;
}

const updateClassicsDisc = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  patch: ClassicsDiscPatch
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) {
    throw new Error(`Game not found: ${gameKey}`);
  }

  const discs = [...(game.discs ?? [])];

  if (patch.addDisc) {
    if (!discs.some((d) => d.path === patch.addDisc!.path)) {
      discs.push(patch.addDisc);
    }
  }

  if (patch.removeDiscPath) {
    const index = discs.findIndex((d) => d.path === patch.removeDiscPath);
    if (index >= 0) discs.splice(index, 1);
  }

  const next = {
    ...game,
    discs,
    selectedDiscPath:
      patch.selectedDiscPath !== undefined
        ? patch.selectedDiscPath
        : game.selectedDiscPath,
    dontAskDiscSelection:
      patch.dontAskDiscSelection !== undefined
        ? patch.dontAskDiscSelection
        : game.dontAskDiscSelection,
    platform: patch.platform !== undefined ? patch.platform : game.platform,
  };

  if (
    next.selectedDiscPath &&
    !discs.some((d) => d.path === next.selectedDiscPath)
  ) {
    next.selectedDiscPath = discs[0]?.path ?? null;
  }

  await gamesSublevel.put(gameKey, next);
  return next;
};

registerEvent("updateClassicsDisc", updateClassicsDisc);
