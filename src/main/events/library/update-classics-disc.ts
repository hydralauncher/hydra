import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { emulators } from "@main/services";
import { platformToSystem } from "@main/helpers";
import type { ClassicsDisc, GameShop } from "@types";

interface ClassicsDiscPatch {
  selectedDiscPath?: string | null;
  dontAskDiscSelection?: boolean;
  platform?: string | null;
  addDisc?: ClassicsDisc;
  removeDiscPath?: string;
}

const applyAddDisc = async (
  discs: ClassicsDisc[],
  addDisc: ClassicsDisc,
  platformHint: string | null | undefined
): Promise<void> => {
  if (discs.some((d) => d.path === addDisc.path)) return;
  if (!addDisc.sku) {
    const system = platformToSystem(platformHint);
    if (system) {
      addDisc.sku = await emulators.extractDiscSku(addDisc.path, system);
    }
  }
  discs.push(addDisc);
};

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
    await applyAddDisc(discs, patch.addDisc, patch.platform ?? game.platform);
  }

  if (patch.removeDiscPath) {
    const index = discs.findIndex((d) => d.path === patch.removeDiscPath);
    if (index >= 0) discs.splice(index, 1);
  }

  const next = { ...game, discs };
  if (patch.selectedDiscPath !== undefined) {
    next.selectedDiscPath = patch.selectedDiscPath;
  }
  if (patch.dontAskDiscSelection !== undefined) {
    next.dontAskDiscSelection = patch.dontAskDiscSelection;
  }
  if (patch.platform !== undefined) {
    next.platform = patch.platform;
  }

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
