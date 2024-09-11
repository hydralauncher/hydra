import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import type { UpdateProfileRequest, UserProfile } from "@types";

const patchUserProfile = async (updateProfile: UpdateProfileRequest) => {
  return HydraApi.patch("/profile", updateProfile);
};

const updateProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  updateProfile: UpdateProfileRequest
): Promise<UserProfile> => {
  if (!updateProfile.profileImageUrl) {
    return patchUserProfile(updateProfile);
  }

  const newProfileImagePath = updateProfile.profileImageUrl;

  const stats = fs.statSync(newProfileImagePath);
  const fileBuffer = fs.readFileSync(newProfileImagePath);
  const fileSizeInBytes = stats.size;

  const profileImageUrl = await HydraApi.post(`/presigned-urls/profile-image`, {
    imageExt: path.extname(newProfileImagePath).slice(1),
    imageLength: fileSizeInBytes,
  })
    .then(async (preSignedResponse) => {
      const { presignedUrl, profileImageUrl } = preSignedResponse;

      const mimeType = await fileTypeFromFile(newProfileImagePath);

      await axios.put(presignedUrl, fileBuffer, {
        headers: {
          "Content-Type": mimeType?.mime,
        },
      });
      return profileImageUrl as string;
    })
    .catch((err) => {
      logger.error("Error uploading profile image", err);

      return undefined;
    });

  return patchUserProfile({ ...updateProfile, profileImageUrl });
};

registerEvent("updateProfile", updateProfile);
