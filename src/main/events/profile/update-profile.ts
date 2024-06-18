import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import axios from "axios";
import fs from "node:fs";
import mime from "mime";

const patchUserProfile = (displayName: string, imageUrl?: string) => {
  return;
  if (imageUrl) {
    return HydraApi.patch("/profile", {
      displayName,
      imageUrl,
    });
  } else {
    return HydraApi.patch("/profile", {
      displayName,
    });
  }
};

const updateProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  displayName: string,
  newProfileImagePath: string | null
): Promise<any> => {
  if (!newProfileImagePath) {
    patchUserProfile(displayName);
    return;
  }

  const stats = fs.statSync(newProfileImagePath);
  const fileBuffer = fs.readFileSync(newProfileImagePath);
  const fileSizeInBytes = stats.size;

  const profileImageUrl = await HydraApi.post(`/presigned-urls/profile-image`, {
    imageExt: newProfileImagePath.split(".").at(-1),
    imageLength: fileSizeInBytes,
  })
    .then(async (preSignedResponse) => {
      const { presignedUrl, profileImageUrl } = preSignedResponse.data;

      const mimeType = mime.getType(newProfileImagePath);

      await axios.put(presignedUrl, fileBuffer, {
        headers: {
          "Content-Type": mimeType,
        },
      });
      return profileImageUrl;
    })
    .catch(() => {
      return undefined;
    });

  console.log(profileImageUrl);
  patchUserProfile(displayName, profileImageUrl);
};

registerEvent("updateProfile", updateProfile);
