import { registerEvent } from "../register-event";
import { repacksSublevel, GameRepack } from "@main/level";

const getAllRepacks = async (_event: Electron.IpcMainInvokeEvent) => {
  const repacks: GameRepack[] = [];

  for await (const [, repack] of repacksSublevel.iterator()) {
    if (Array.isArray(repack.objectIds)) {
      repacks.push(repack);
    }
  }

  return repacks;
};

registerEvent("getAllRepacks", getAllRepacks);
