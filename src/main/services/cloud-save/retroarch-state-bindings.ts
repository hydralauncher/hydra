import path from "node:path";

import {
  cloudSaveRetroArchBindingsSublevel,
  db,
  levelKeys,
  type RetroArchBindingRecord,
} from "@main/level";
import type { Game, User } from "@types";

export {
  legacyRetroArchStateId,
  remoteRetroArchStateId,
  reconcileRetroArchStateBindings,
  retroArchStateCloudIdentity,
  type RetroArchObservedState,
} from "./retroarch-state-binding-policy.js";

const bindingKey = async (game: Game) => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!user?.id) throw new Error("cloud_save_user_required");
  return JSON.stringify([user.id, game.shop, game.objectId, "retroarch-v2"]);
};

export const loadRetroArchBindings = async (
  game: Game
): Promise<RetroArchBindingRecord> => {
  const stored = await cloudSaveRetroArchBindingsSublevel.get(
    await bindingKey(game)
  );
  if (
    stored?.version === 1 &&
    Array.isArray(stored.states) &&
    stored.states.every(
      (state) =>
        /^[a-f0-9]{64}$/.test(state.id) &&
        path.isAbsolute(state.path) &&
        /^\.state(?:\d+|\.auto)?$/.test(state.slot) &&
        /^[a-f0-9]{64}$/.test(state.hash)
    )
  ) {
    return stored;
  }
  return { version: 1, activeRomPath: null, states: [] };
};

export const saveRetroArchBindings = async (
  game: Game,
  record: RetroArchBindingRecord
) => {
  await cloudSaveRetroArchBindingsSublevel.put(await bindingKey(game), record);
};
