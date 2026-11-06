import { getSteamReviewSummary } from "@main/services/steam-review-summary";
import { registerEvent } from "../register-event";

const getSteamReviewSummaryEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  steamAppId: string
) => {
  return getSteamReviewSummary(steamAppId);
};

registerEvent("getSteamReviewSummary", getSteamReviewSummaryEvent);
