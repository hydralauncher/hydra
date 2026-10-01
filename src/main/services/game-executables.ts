import axios from "axios";

import type { KnownGameExecutable } from "@main/helpers/game-executable-ranking";
import { logger } from "./logger";
import {
  GameExecutableCatalogStore,
  type GameExecutableCatalogResponse,
} from "./game-executables-core";

type ExecutableCatalogueShop = "steam" | "epic";

const catalogStores: Record<
  ExecutableCatalogueShop,
  GameExecutableCatalogStore
> = {
  steam: new GameExecutableCatalogStore(process.platform),
  epic: new GameExecutableCatalogStore(process.platform),
};

const loadGameExecutables = async (shop: ExecutableCatalogueShop) => {
  try {
    const response = await axios.get<GameExecutableCatalogResponse>(
      `${import.meta.env.MAIN_VITE_API_URL}/catalogue/${shop}/executables`
    );
    return response.data;
  } catch (error) {
    logger.error(`Failed to load ${shop} game executable catalogue`, error);
    throw error;
  }
};

export class GameExecutables {
  static ensureLoaded(forceRetry = false): Promise<boolean> {
    return this.ensureLoadedForShop("steam", forceRetry);
  }

  static ensureLoadedForShop(
    shop: ExecutableCatalogueShop,
    forceRetry = false
  ): Promise<boolean> {
    return catalogStores[shop].ensureLoaded(
      () => loadGameExecutables(shop),
      forceRetry
    );
  }

  static getExecutablesForGame(
    objectId: string,
    shop: ExecutableCatalogueShop = "steam"
  ): KnownGameExecutable[] | null {
    return catalogStores[shop].getForGame(objectId);
  }

  static getAllObjectIds(): string[] {
    return catalogStores.steam.getAllObjectIds();
  }
}
