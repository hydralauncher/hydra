import type { HowLongToBeatCategory } from "@types";
import { getHowLongToBeatGame, searchHowLongToBeat } from "@main/services";

import { registerEvent } from "../register-event";
import { formatName } from "@shared";

const getHowLongToBeat = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string
): Promise<HowLongToBeatCategory[] | null> => {
  const response = await searchHowLongToBeat(title);

  const game = response.data.find((game) => {
    return formatName(game.game_name) === formatName(title);
  });

  if (!game) return null;
  const howLongToBeat = await getHowLongToBeatGame(String(game.game_id));

  return howLongToBeat;
};

registerEvent("getHowLongToBeat", getHowLongToBeat);
