import { getCalendarMonth } from "@main/services";
import { registerEvent } from "../register-event";

const getCrackCalendarMonth = async (
  _event: Electron.IpcMainInvokeEvent,
  month: string
) => {
  return getCalendarMonth(month);
};

registerEvent("get-crack-calendar-month", getCrackCalendarMonth);
