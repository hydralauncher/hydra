import type { GameShop, HowLongToBeatCategory } from "@types";
import { getHowLongToBeatGame, searchHowLongToBeat } from "@main/services";

import { registerEvent } from "../register-event";

const getHowLongToBeat = async (
  _event: Electron.IpcMainInvokeEvent,
  objectID: string,
  _shop: GameShop,
  title: string
): Promise<HowLongToBeatCategory[] | null> => {
  const response = await searchHowLongToBeat(title);
  const game = response.data.find(
    (game) => game.profile_steam === Number(objectID)
  );

  if (!game) return null;
  const howLongToBeat = await getHowLongToBeatGame(String(game.game_id));
  return howLongToBeat;
};

registerEvent(getHowLongToBeat, {
  name: "getHowLongToBeat",
  memoize: true,
});
