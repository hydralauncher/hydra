import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { HydraApi } from "@main/services/hydra-api";
import type { AchievementSouvenirUploadAuthorization } from "@types";

interface AchievementImagePresignedUrl {
  presignedUrl: string;
  imageKey: string;
}

export class AchievementImageService {
  public static async authorizeAchievementImage(
    imagePath: string,
    remoteGameId: string,
    clientId: string
  ) {
    const image = await fs.promises.readFile(imagePath);
    const imageExt = path.extname(imagePath).slice(1);

    const authorization =
      await HydraApi.post<AchievementSouvenirUploadAuthorization>(
        "/presigned-urls/achievement-image",
        {
          imageExt,
          imageLength: image.byteLength,
          remoteGameId,
          clientId,
        },
        { needsSubscription: false }
      );

    return { authorization, image };
  }

  public static async uploadAuthorizedAchievementImage(
    presignedUrl: string,
    image: Buffer
  ) {
    await axios.put(presignedUrl, image, {
      headers: { "Content-Type": "image/jpeg" },
    });
  }

  public static async uploadAchievementImage(imagePath: string) {
    const image = await fs.promises.readFile(imagePath);
    const imageExt = path.extname(imagePath).slice(1);

    const { presignedUrl, imageKey } =
      await HydraApi.post<AchievementImagePresignedUrl>(
        "/presigned-urls/achievement-image",
        { imageExt, imageLength: image.byteLength },
        { needsSubscription: true }
      );

    await axios.put(presignedUrl, image, {
      headers: { "Content-Type": `image/${imageExt}` },
    });

    return imageKey;
  }
}
