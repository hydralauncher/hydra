import fs from "fs";
import path from "path";
import axios from "axios";
import { fileTypeFromFile } from "file-type";
import { HydraApi } from "@main/services/hydra-api";
import { registerEvent } from "../register-event";
import { gameAchievementsSublevel, levelKeys, db } from "@main/level";
import { logger } from "@main/services/logger";
import type { GameShop, User } from "@types";

/**
 * Uploads an achievement image to CDN using presigned URL
 */
const uploadImageToCDN = async (imagePath: string): Promise<string> => {
  const stat = fs.statSync(imagePath);
  const fileBuffer = fs.readFileSync(imagePath);
  const fileSizeInBytes = stat.size;

  // Get presigned URL for achievement image
  const response = await HydraApi.post<{ 
    presignedUrl: string; 
    achievementImageUrl: string; 
  }>("/presigned-urls/achievement-image", {
    imageExt: path.extname(imagePath).slice(1),
    imageLength: fileSizeInBytes,
  });

  const mimeType = await fileTypeFromFile(imagePath);

  // Upload to CDN
  await axios.put(response.presignedUrl, fileBuffer, {
    headers: {
      "Content-Type": mimeType?.mime,
    },
  });

  return response.achievementImageUrl;
};

/**
 * Stores achievement image locally in the database
 */
const storeImageLocally = async (imagePath: string): Promise<string> => {
  const fileBuffer = fs.readFileSync(imagePath);
  const base64Image = fileBuffer.toString('base64');
  const mimeType = await fileTypeFromFile(imagePath);
  
  // Create a data URL for local storage
  return `data:${mimeType?.mime || 'image/jpeg'};base64,${base64Image}`;
};

/**
 * Updates the achievement with the image URL via API
 */
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

/**
 * Main function for uploading achievement images (called from mergeAchievements)
 */
export const uploadAchievementImage = async (
  gameId: string,
  achievementName: string,
  imagePath: string,
  shop?: GameShop
): Promise<{ success: boolean; imageUrl: string }> => {
  try {
    let imageUrl: string;

    // Check if user has active subscription
  const hasSubscription = await db
    .get<string, User>(levelKeys.user, { valueEncoding: "json" })
    .then((user) => {
      const expiresAt = new Date(user?.subscription?.expiresAt ?? 0);
      return expiresAt > new Date();
    })
    .catch(() => false);

    if (hasSubscription) {
      // Upload to CDN and update via API
      imageUrl = await uploadImageToCDN(imagePath);
      if (shop) {
        await updateAchievementWithImageUrl(shop, gameId, achievementName, imageUrl);
      }
      logger.log(`Achievement image uploaded to CDN for ${gameId}:${achievementName}`);
    } else {
      // Store locally
      imageUrl = await storeImageLocally(imagePath);
      logger.log(`Achievement image stored locally for ${gameId}:${achievementName}`);
    }

    return { success: true, imageUrl };

  } catch (error) {
    logger.error(`Failed to upload achievement image for ${gameId}:${achievementName}:`, error);
    throw error;
  }
};

/**
 * IPC event handler for uploading achievement images
 */
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
    const result = await uploadAchievementImage(gameId, achievementName, imagePath, shop);

    // Update local database with image URL
    const achievementKey = levelKeys.game(shop, gameId);
    const existingData = await gameAchievementsSublevel.get(achievementKey).catch(() => null);
    
    if (existingData) {
      await gameAchievementsSublevel.put(achievementKey, {
        ...existingData,
        achievementImageUrl: result.imageUrl,
      });
    }

    // Clean up the temporary screenshot file
    try {
      fs.unlinkSync(imagePath);
    } catch (error) {
      logger.error(`Failed to cleanup screenshot file ${imagePath}:`, error);
    }

    return result;

  } catch (error) {
    // Clean up the temporary screenshot file even on error
    try {
      fs.unlinkSync(imagePath);
    } catch (cleanupError) {
      logger.error(`Failed to cleanup screenshot file ${imagePath}:`, cleanupError);
    }
    
    throw error;
  }
};

registerEvent("uploadAchievementImage", uploadAchievementImageEvent);