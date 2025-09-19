import { registerEvent } from "../register-event";
import type { GameRef, GamesOrganizerResult } from "@types";
import { createFolderAndPlaceGames } from "@main/services/gamesoganizer";

const createGamesFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string,
  games: GameRef[]
): Promise<GamesOrganizerResult> => {
  return createFolderAndPlaceGames(folderPath, games);
};

registerEvent("createGamesFolder", createGamesFolder);
