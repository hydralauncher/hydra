import fs from "fs";
import path from "path";
import axios from "axios";
import { fileTypeFromFile } from "file-type";
import { HydraApi } from "@main/services/hydra-api";
import { registerEvent } from "../register-event";
import { gameAchievementsSublevel, levelKeys, db } from "@main/level";
import { logger } from "@main/services/logger";
import type { GameShop, User } from "@types";


const uploadImageToCDN = async (imagePath: string): Promise<string> => {
  const stat = fs.statSync(imagePath);
  const fileBuffer = fs.readFileSync(imagePath);
  const fileSizeInBytes = stat.size;

  const response = await HydraApi.post<{
    presignedUrl: string;
    achievementImageUrl: string;
  }>("/presigned-urls/achievement-image", {
    imageExt: path.extname(imagePath).slice(1),
    imageLength: fileSizeInBytes,
  });

  const mimeType = await fileTypeFromFile(imagePath);

  await axios.put(response.presignedUrl, fileBuffer, {
    headers: {
      "Content-Type": mimeType?.mime,
    },
  });

  return response.achievementImageUrl;
};


const storeImageLocally = async (imagePath: string): Promise<string> => {
  const fileBuffer = fs.readFileSync(imagePath);
  const base64Image = fileBuffer.toString("base64");
  const mimeType = await fileTypeFromFile(imagePath);

  return `data:${mimeType?.mime || "image/jpeg"};base64,${base64Image}`;
};


const updateAchievementWithImageUrl = async (
  shop: GameShop,
  gameId: string,
  achievementName: string,
  imageUrl: string
): Promise<void> => {
  await HydraApi.patch(
    `/profile/games/achievements/${shop}/${gameId}/${achievementName}/image`,
    { achievementImageUrl: imageUrl }
  );
};


export const uploadAchievementImage = async (
  gameId: string,
  achievementName: string,
  imagePath: string,
  shop?: GameShop
): Promise<{ success: boolean; imageUrl: string }> => {
  try {
    let imageUrl: string;

    const hasSubscription = await db
      .get<string, User>(levelKeys.user, { valueEncoding: "json" })
      .then((user) => {
        const expiresAt = new Date(user?.subscription?.expiresAt ?? 0);
        return expiresAt > new Date();
      })
      .catch(() => false);

    if (hasSubscription) {
      imageUrl = await uploadImageToCDN(imagePath);
      if (shop) {
        await updateAchievementWithImageUrl(
          shop,
          gameId,
          achievementName,
          imageUrl
        );
      }
      logger.log(
        `Achievement image uploaded to CDN for ${gameId}:${achievementName}`
      );
    } else {
      imageUrl = await storeImageLocally(imagePath);
      logger.log(
        `Achievement image stored locally for ${gameId}:${achievementName}`
      );
    }

    return { success: true, imageUrl };
  } catch (error) {
    logger.error(
      `Failed to upload achievement image for ${gameId}:${achievementName}:`,
      error
    );
    throw error;
  }
};


const uploadAchievementImageEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  params: {
    imagePath: string;
    gameId: string;
    achievementName: string;
    shop: GameShop;
  }
) => {
  const { imagePath, gameId, achievementName, shop } = params;

  try {
    const result = await uploadAchievementImage(
      gameId,
      achievementName,
      imagePath,
      shop
    );

    const achievementKey = levelKeys.game(shop, gameId);
    const existingData = await gameAchievementsSublevel
      .get(achievementKey)
      .catch(() => null);

    if (existingData) {
      await gameAchievementsSublevel.put(achievementKey, {
        ...existingData,
        achievementImageUrl: result.imageUrl,
      });
    }

    try {
      fs.unlinkSync(imagePath);
    } catch (error) {
      logger.error(`Failed to cleanup screenshot file ${imagePath}:`, error);
    }

    return result;
  } catch (error) {
    try {
      fs.unlinkSync(imagePath);
    } catch (cleanupError) {
      logger.error(
        `Failed to cleanup screenshot file ${imagePath}:`,
        cleanupError
      );
    }

    throw error;
  }
};

registerEvent("uploadAchievementImage", uploadAchievementImageEvent);
