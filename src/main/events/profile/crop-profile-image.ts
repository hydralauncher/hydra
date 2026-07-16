import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import {
  canSkipImageCrop,
  cropProfileImageWithInfo,
  getCropProfileImageMetadata,
  type CropProfileImageParams,
} from "./crop-profile-image-processor";

export type { CropProfileImageParams } from "./crop-profile-image-processor";

const cropProfileImage = async (
  _event: Electron.IpcMainInvokeEvent,
  sourcePath: string,
  params: CropProfileImageParams
): Promise<{ imagePath: string }> => {
  try {
    return await cropProfileImageInternal(sourcePath, params);
  } catch (error) {
    logger.error("Failed to crop profile image", sourcePath, params, error);
    throw error;
  }
};

const cropProfileImageInternal = async (
  sourcePath: string,
  params: CropProfileImageParams
): Promise<{ imagePath: string }> => {
  const sourceMetadata = await getCropProfileImageMetadata(sourcePath);
  const sourceWidth = sourceMetadata.width ?? 0;
  const sourceHeight = sourceMetadata.pageHeight ?? sourceMetadata.height ?? 0;
  const skipProcessing =
    sourceWidth > 0 &&
    sourceHeight > 0 &&
    canSkipImageCrop(sourceWidth, sourceHeight, params);
  const extension = skipProcessing
    ? path.extname(sourcePath).toLowerCase() || `.${sourceMetadata.format}`
    : ".webp";

  const tempFilePath = path.join(
    app.getPath("temp"),
    `hydra-temp-${Date.now()}-profile-crop${extension}`
  );

  if (skipProcessing) {
    await fs.promises.copyFile(sourcePath, tempFilePath);
  } else {
    const { data } = await cropProfileImageWithInfo(
      sourcePath,
      params,
      sourceMetadata
    );
    await fs.promises.writeFile(tempFilePath, data);
  }

  return { imagePath: tempFilePath };
};

registerEvent("cropProfileImage", cropProfileImage);
