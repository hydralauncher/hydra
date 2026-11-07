import axios from "axios";

import type { KnownGameExecutable } from "@main/helpers/game-executable-ranking";
import { logger } from "./logger";
import {
  GameExecutableCatalogStore,
  type GameExecutableCatalogResponse,
} from "./game-executables-core";

const catalogStore = new GameExecutableCatalogStore(process.platform);

const loadGameExecutables = async () => {
  const apiUrl = import.meta.env.MAIN_VITE_API_URL?.trim();
  // Local development is allowed without the Hydra API. Treat the optional
  // catalogue as unavailable rather than handing Axios an invalid relative URL.
  if (!apiUrl) return {};

  try {
    const response = await axios.get<GameExecutableCatalogResponse>(
      `${apiUrl}/catalogue/steam/executables`
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
