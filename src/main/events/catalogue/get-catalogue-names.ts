import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { catalogueNamesCacheSublevel } from "@main/level";

const LOCAL_CACHE_EXPIRATION = 1000 * 60 * 60 * 24; // 24 hours

const getCatalogueNames = async (
  _event: Electron.IpcMainInvokeEvent,
  list: "developers" | "publishers"
) => {
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

    await catalogueNamesCacheSublevel.put(cacheKey, {
      names,
      updatedAt: Date.now(),
    });

    return names;
  } catch (error) {
    if (!cached) throw error;

    logger.error(`Failed to refresh catalogue ${list}`, error);
    return cached.names;
  }
};

registerEvent("getCatalogueNames", getCatalogueNames);
