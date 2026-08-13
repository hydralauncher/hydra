import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { fileTypeFromFile } from "file-type";
import { HydraApi } from "@main/services/hydra-api";

interface AchievementImagePresignedUrl {
  presignedUrl: string;
  imageKey: string;
}

export class AchievementImageService {
  public static async uploadAchievementImage(imagePath: string) {
    const { size } = await fs.promises.stat(imagePath);

    const { presignedUrl, imageKey } =
      await HydraApi.post<AchievementImagePresignedUrl>(
        "/presigned-urls/achievement-image",
        {
          imageExt: path.extname(imagePath).slice(1),
          imageLength: size,
        },
        { needsSubscription: true }
      );

    const fileType = await fileTypeFromFile(imagePath);

    await axios.put(presignedUrl, await fs.promises.readFile(imagePath), {
      headers: { "Content-Type": fileType?.mime },
    });

    return imageKey;
  }
}
