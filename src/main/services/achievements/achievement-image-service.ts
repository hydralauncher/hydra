import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { HydraApi } from "@main/services/hydra-api";

interface AchievementImagePresignedUrl {
  presignedUrl: string;
  imageKey: string;
}

export class AchievementImageService {
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
