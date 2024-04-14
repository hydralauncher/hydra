import { imageCacheRepository } from "@main/repository";

import { registerEvent } from "../register-event";
import { getImageBase64 } from "@main/helpers";
import { logger } from "@main/services";

const getOrCacheImage = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  const cache = await imageCacheRepository.findOne({
    where: {
      url,
    },
  });

  if (cache) return cache.data;

  getImageBase64(url).then((data) =>
    imageCacheRepository
      .save({
        url,
        data,
      })
      .catch(() => {
        logger.error(`Failed to cache image "${url}"`, {
          method: "getOrCacheImage",
        });
      })
  );

  return url;
};

registerEvent(getOrCacheImage, {
  name: "getOrCacheImage",
});
