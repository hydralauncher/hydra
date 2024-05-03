import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { registerEvent } from "../register-event";
import { getFileBuffer } from "@main/helpers";
import { logger } from "@main/services";
import { imageCachePath } from "@main/constants";

const getOrCacheImage = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  if (!fs.existsSync(imageCachePath)) fs.mkdirSync(imageCachePath);

  const extname = path.extname(url);

  const checksum = crypto.createHash("sha256").update(url).digest("hex");
  const cachePath = path.join(imageCachePath, `${checksum}${extname}`);

  const cache = fs.existsSync(cachePath);

  if (cache) return `hydra://${cachePath}`;

  getFileBuffer(url).then((buffer) =>
    fs.writeFile(cachePath, buffer, (err) => {
      if (err) {
        logger.error(`Failed to cache image`, err, {
          method: "getOrCacheImage",
        });
      }
    })
  );

  return url;
};

registerEvent(getOrCacheImage, {
  name: "getOrCacheImage",
});
