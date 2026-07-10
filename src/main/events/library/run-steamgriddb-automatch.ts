import { registerEvent } from "../register-event";
import { matchGame, runAutoMatch } from "@main/services";
import type { GameShop } from "@types";

interface RunAutoMatchParams {
  shop?: GameShop;
  objectId?: string;
  forceFresh?: boolean;
}

const runSteamGridDbAutoMatch = async (
  _event: Electron.IpcMainInvokeEvent,
  params?: RunAutoMatchParams
) => {
  if (params?.shop && params?.objectId) {
    await matchGame(params.shop, params.objectId, {
      forceFresh: params.forceFresh,
    });
    return { success: true };
  }

  runAutoMatch({ forceFresh: params?.forceFresh }).catch(() => {});
  return { success: true };
};

registerEvent("runSteamGridDbAutoMatch", runSteamGridDbAutoMatch);
