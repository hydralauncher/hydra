import axios from "axios";

import type { KnownGameExecutable } from "@main/helpers/game-executable-ranking";
import { logger } from "./logger";
import {
  normalizeGameExecutableCatalog,
  type GameExecutableCatalog,
  type GameExecutableCatalogResponse,
} from "./game-executables-core";

let gameExecutables: GameExecutableCatalog = {};
let loadPromise: Promise<boolean> | null = null;

const loadGameExecutables = async () => {
  try {
    const response = await axios.get<GameExecutableCatalogResponse>(
      `${import.meta.env.MAIN_VITE_API_URL}/catalogue/steam/executables`
    );

    gameExecutables = normalizeGameExecutableCatalog(
      response.data,
      process.platform
    );

    return Object.keys(gameExecutables).length > 0;
  } catch (error) {
    logger.error("Failed to load game executable catalogue", error);
    return false;
  }
};

export class GameExecutables {
  static async ensureLoaded(): Promise<boolean> {
    if (Object.keys(gameExecutables).length > 0) return true;

    if (!loadPromise) {
      loadPromise = loadGameExecutables().finally(() => {
        loadPromise = null;
      });
    }

    return loadPromise;
  }

  static getExecutablesForGame(objectId: string): KnownGameExecutable[] | null {
    const executables = gameExecutables[objectId];

    if (!executables || executables.length === 0) {
      return null;
    }

    return executables.map((executable) => ({
      exe: executable.exe,
      name: executable.name,
    }));
  }

  static getAllObjectIds(): string[] {
    return Object.keys(gameExecutables);
  }
}
