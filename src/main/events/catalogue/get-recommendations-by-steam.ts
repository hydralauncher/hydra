import { getSteamRecommendationsByGenreService } from "@main/services";
import { registerEvent } from "../register-event";
import { searchGamesByID } from "../helpers/search-games";

const getSteamRecommendationsByGenre = async (
  _event: Electron.IpcMainInvokeEvent,
  gameID: string
) => {
  return getSteamRecommendationsByGenreService(gameID);
};
registerEvent("getSteamRecommendationsByGenre", getSteamRecommendationsByGenre);

const getGameListByID = async (
  _event: Electron.IpcMainInvokeEvent,
  gameID: string | string[]
) => {
  return searchGamesByID(gameID);
};
registerEvent("searchGamesByID", getGameListByID);
