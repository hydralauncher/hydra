import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { fileTypeFromFile } from "file-type";
import { HydraApi } from "@main/services/hydra-api";
import { gameAchievementsSublevel, levelKeys, db } from "@main/level";
import { logger } from "@main/services/logger";
import type { GameShop, User } from "@types";

export class AchievementImageService {
  private static async uploadImageToCDN(imagePath: string): Promise<string> {
    const stat = fs.statSync(imagePath);
    const fileBuffer = fs.readFileSync(imagePath);
    const fileSizeInBytes = stat.size;

    const response = await HydraApi.post<{
      presignedUrl: string;
      imageUrl: string;
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

    return response.imageUrl;
  }

  private static async storeImageLocally(imagePath: string): Promise<string> {
    const fileBuffer = fs.readFileSync(imagePath);
    const base64Image = fileBuffer.toString("base64");
    const mimeType = await fileTypeFromFile(imagePath);

    return `data:${mimeType?.mime || "image/jpeg"};base64,${base64Image}`;
  }


  private static async hasActiveSubscription(): Promise<boolean> {
    return db
      .get<string, User>(levelKeys.user, { valueEncoding: "json" })
      .then((user) => {
        const expiresAt = new Date(user?.subscription?.expiresAt ?? 0);
        return expiresAt > new Date();
      })
      .catch(() => false);
  }

  private static async updateLocalAchievementData(
    shop: GameShop,
    gameId: string,
    imageUrl: string
  ): Promise<void> {
    const achievementKey = levelKeys.game(shop, gameId);
    const existingData = await gameAchievementsSublevel
      .get(achievementKey)
      .catch(() => null);

    if (existingData) {
      await gameAchievementsSublevel.put(achievementKey, {
        ...existingData,
        imageUrl,
      });
    }
  }

  private static cleanupImageFile(imagePath: string): void {
    try {
      fs.unlinkSync(imagePath);
    } catch (error) {
      logger.error(`Failed to cleanup screenshot file ${imagePath}:`, error);
    }
  }

  /**
   * Uploads an achievement image either to CDN (for subscribers) or stores locally
   * @param gameId - The game identifier
   * @param achievementName - The achievement name
   * @param imagePath - Path to the image file to upload
   * @param shop - The game shop (optional)
   * @returns Promise with success status and image URL
   */
  static async uploadAchievementImage(
    gameId: string,
    achievementName: string,
    imagePath: string
  ): Promise<{ success: boolean; imageUrl: string }> {
    try {
      let imageUrl: string;

      const hasSubscription = await this.hasActiveSubscription();

      if (hasSubscription) {
        imageUrl = await this.uploadImageToCDN(imagePath);
        // Removed per new single-call sync: image URL will be included
        // in the PUT /profile/games/achievements payload later.
        // No direct API call here anymore.
        logger.log(
          `Achievement image uploaded to CDN for ${gameId}:${achievementName}`
        );
      } else {
        imageUrl = await this.storeImageLocally(imagePath);
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
  }

  /**
   * Uploads achievement image and updates local database, with automatic cleanup
   * @param gameId - The game identifier
   * @param achievementName - The achievement name
   * @param imagePath - Path to the image file to upload
   * @param shop - The game shop
   * @returns Promise with success status and image URL
   */
  static async uploadAndUpdateAchievementImage(
    gameId: string,
    achievementName: string,
    imagePath: string,
    shop: GameShop
  ): Promise<{ success: boolean; imageUrl: string }> {
    try {
      const result = await this.uploadAchievementImage(
        gameId,
        achievementName,
        imagePath
      );

      await this.updateLocalAchievementData(shop, gameId, result.imageUrl);

      this.cleanupImageFile(imagePath);

      return result;
    } catch (error) {
      this.cleanupImageFile(imagePath);
      throw error;
    }
  }
}
