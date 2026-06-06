import { getGameDetail } from "@main/services";
import { registerEvent } from "../register-event";

const getCrackCalendarGame = async (
  _event: Electron.IpcMainInvokeEvent,
  slug: string
) => {
  return getGameDetail(slug);
};

registerEvent("get-crack-calendar-game", getCrackCalendarGame, {
  needsAuth: false,
});
