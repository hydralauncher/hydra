import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { catalogueNamesCacheSublevel } from "@main/level";

const LOCAL_CACHE_EXPIRATION = 1000 * 60 * 60 * 24; // 24 hours

const getCatalogueNames = async (
  _event: Electron.IpcMainInvokeEvent,
  list: "developers" | "publishers"
) => {
  if (list !== "developers" && list !== "publishers") {
    throw new Error(`Invalid catalogue list: ${list}`);
  }

  const cacheKey = `steam:${list}`;
  const cached = await catalogueNamesCacheSublevel
    .get(cacheKey)
    .catch(() => undefined);

  if (cached && cached.updatedAt + LOCAL_CACHE_EXPIRATION > Date.now()) {
    return cached.names;
  }

  try {
    const names = await HydraApi.get<string[]>(
      `/catalogue/steam/${list}`,
      null,
      { needsAuth: false }
    );

    if (!Array.isArray(names)) {
      throw new Error(`Invalid catalogue ${list} response`);
    }

    await catalogueNamesCacheSublevel
      .put(cacheKey, {
        names,
        updatedAt: Date.now(),
      })
      .catch((error) => {
        logger.error(`Failed to cache catalogue ${list}`, error);
      });

    return names;
  } catch (error) {
    if (!cached) throw error;

    logger.error(`Failed to refresh catalogue ${list}`, error);
    return cached.names;
  }
};

registerEvent("getCatalogueNames", getCatalogueNames);
