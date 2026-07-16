import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";

import { logger } from "@main/services";
import { registerEvent } from "../register-event";
import {
  cropProfileImageToBuffer,
  type CropProfileImageParams,
} from "./crop-profile-image-processor";

export type { CropProfileImageParams } from "./crop-profile-image-processor";

const cropProfileImage = async (
  _event: Electron.IpcMainInvokeEvent,
  sourcePath: string,
  params: CropProfileImageParams
): Promise<{ imagePath: string }> => {
  try {
    const buffer = await cropProfileImageToBuffer(sourcePath, params);
    const imagePath = path.join(
      app.getPath("temp"),
      `hydra-temp-${randomUUID()}-profile-crop.webp`
    );

    await fs.promises.writeFile(imagePath, buffer);
    return { imagePath };
  } catch (error) {
    logger.error("Failed to crop profile image", sourcePath, params, error);
    throw error;
  }
};

registerEvent("cropProfileImage", cropProfileImage);
