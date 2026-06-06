import { getAvailableMonths } from "@main/services";
import { registerEvent } from "../register-event";

const getCrackCalendarMonths = async (_event: Electron.IpcMainInvokeEvent) => {
  return getAvailableMonths();
};

registerEvent("get-crack-calendar-months", getCrackCalendarMonths, {
  needsAuth: false,
});
