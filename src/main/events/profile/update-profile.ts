import { registerEvent } from "../register-event";
import { HydraApi, PythonInstance } from "@main/services";
import fs from "node:fs";
import path from "node:path";
import type { UpdateProfileRequest, UserProfile } from "@types";
import { omit } from "lodash-es";
import axios from "axios";

interface PresignedResponse {
  presignedUrl: string;
  profileImageUrl: string;
}

const patchUserProfile = async (updateProfile: UpdateProfileRequest) => {
  return HydraApi.patch<UserProfile>("/profile", updateProfile);
};

const getNewProfileImageUrl = async (localImageUrl: string) => {
  const { imagePath, mimeType } =
    await PythonInstance.processProfileImage(localImageUrl);

  const stats = fs.statSync(imagePath);
  const fileBuffer = fs.readFileSync(imagePath);
  const fileSizeInBytes = stats.size;

  const { presignedUrl, profileImageUrl } =
    await HydraApi.post<PresignedResponse>(`/presigned-urls/profile-image`, {
      imageExt: path.extname(imagePath).slice(1),
      imageLength: fileSizeInBytes,
    });

  await axios.put(presignedUrl, fileBuffer, {
    headers: {
      "Content-Type": mimeType,
    },
  });

  return profileImageUrl;
};

const updateProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  updateProfile: UpdateProfileRequest
) => {
  if (!updateProfile.profileImageUrl) {
    return patchUserProfile(omit(updateProfile, "profileImageUrl"));
  }

  const profileImageUrl = await getNewProfileImageUrl(
    updateProfile.profileImageUrl
  ).catch(() => undefined);

  return patchUserProfile({ ...updateProfile, profileImageUrl });
};

registerEvent("updateProfile", updateProfile);
