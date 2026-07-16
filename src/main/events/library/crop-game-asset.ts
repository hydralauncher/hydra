import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";

import { logger } from "@main/services";
import { NativeAddon } from "@main/services/native-addon";
import { registerEvent } from "../register-event";
import {
  cropGameAssetToPath,
  type CropGameAssetParams,
  type CropGameAssetResult,
} from "./crop-game-asset-processor";

const cropGameAsset = async (
  _event: Electron.IpcMainInvokeEvent,
  sourcePath: string,
  params: CropGameAssetParams
): Promise<CropGameAssetResult> => {
  const outputPathBase = path.join(
    app.getPath("temp"),
    `hydra-temp-${randomUUID()}-game-asset-crop`
  );

  try {
    return await cropGameAssetToPath(
      sourcePath,
      outputPathBase,
      params,
      (imagePath, cropParams) =>
        NativeAddon.prepareAnimatedPngCrop(imagePath, cropParams)
    );
  } catch (error) {
    logger.error("Failed to crop game asset", sourcePath, params, error);
    throw error;
  }
};

registerEvent("cropGameAsset", cropGameAsset);
