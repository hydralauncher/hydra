import axios from "axios";

import type { KnownGameExecutable } from "@main/helpers/game-executable-ranking";
import { logger } from "./logger";
import {
  GameExecutableCatalogStore,
  type GameExecutableCatalogResponse,
} from "./game-executables-core";

const catalogStore = new GameExecutableCatalogStore(process.platform);

const loadGameExecutables = async () => {
  try {
    const response = await axios.get<GameExecutableCatalogResponse>(
      `${import.meta.env.MAIN_VITE_API_URL}/catalogue/steam/executables`
    );
    return response.data;
  } catch (error) {
    logger.error("Failed to load game executable catalogue", error);
    throw error;
  }
};

export class GameExecutables {
  static ensureLoaded(forceRetry = false): Promise<boolean> {
    return catalogStore.ensureLoaded(loadGameExecutables, forceRetry);
  }

  static getExecutablesForGame(objectId: string): KnownGameExecutable[] | null {
    return catalogStore.getForGame(objectId);
  }

  static getAllObjectIds(): string[] {
    return catalogStore.getAllObjectIds();
  }
}
