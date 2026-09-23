import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { createGame } from "@main/services/library-sync";
import { HydraApi } from "@main/services";
import type { GameShop } from "@types";

const isGameNotFoundError = (error: unknown) => {
  if (typeof error !== "object" || error === null) return false;
  const response = (error as { response?: { data?: { message?: unknown } } })
    .response;
  return response?.data?.message === "game/not-found";
};

const setGameVisibility = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  field: "hide" | "isHidden",
  value: boolean
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);
  if (!game || game.isDeleted || shop === "custom") {
    throw new Error("game/not-found-local");
  }

  const path = `/profile/games/${shop}/${objectId}/${field === "hide" ? "hide" : "hidden"}`;
  const save = () =>
    value
      ? HydraApi.put<{ hide: boolean; isHidden: boolean }>(path)
      : HydraApi.delete<{ hide: boolean; isHidden: boolean }>(path);

  let saved;
  try {
    saved = await save();
  } catch (error) {
    if (!isGameNotFoundError(error)) throw error;
    await createGame(game);
    saved = await save();
  }

  await gamesSublevel.put(gameKey, {
    ...(await gamesSublevel.get(gameKey))!,
    hide: saved.hide,
    isHidden: saved.isHidden,
  });

  return saved;
};

registerEvent("setGameVisibility", setGameVisibility);
