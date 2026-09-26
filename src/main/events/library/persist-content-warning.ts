import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamContentWarning } from "@shared";
import type { GameShop } from "@types";

export const persistContentWarning = async (
  shop: GameShop,
  objectId: string,
  contentDescriptorIds: number[]
) => {
  const key = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(key);
  if (!game) return;

  const contentWarning = getSteamContentWarning(contentDescriptorIds);
  await gamesSublevel.put(key, { ...game, contentWarning });
};
