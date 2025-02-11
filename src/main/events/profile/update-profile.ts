import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import fs from "node:fs";
import path from "node:path";
import type { UpdateProfileRequest, UserProfile } from "@types";
import { omit } from "lodash-es";
import axios from "axios";
import { fileTypeFromFile } from "file-type";

export const patchUserProfile = async (updateProfile: UpdateProfileRequest) => {
  return HydraApi.patch<UserProfile>("/profile", updateProfile);
};

const uploadImage = async (
  type: "profile-image" | "background-image",
  imagePath: string
) => {
  const stat = fs.statSync(imagePath);
  const fileBuffer = fs.readFileSync(imagePath);
  const fileSizeInBytes = stat.size;

  const response = await HydraApi.post<{ presignedUrl: string }>(
    `/presigned-urls/${type}`,
    {
      imageExt: path.extname(imagePath).slice(1),
      imageLength: fileSizeInBytes,
    }
  );

  const mimeType = await fileTypeFromFile(imagePath);

  await axios.put(response.presignedUrl, fileBuffer, {
    headers: {
      "Content-Type": mimeType?.mime,
    },
  });

  if (type === "background-image") {
    return response["backgroundImageUrl"];
  }

  return response["profileImageUrl"];
};

const updateProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  updateProfile: UpdateProfileRequest
) => {
  const payload = omit(updateProfile, [
    "profileImageUrl",
    "backgroundImageUrl",
  ]);

  if (updateProfile.profileImageUrl) {
    const profileImageUrl = await uploadImage(
      "profile-image",
      updateProfile.profileImageUrl
    ).catch(() => undefined);

    payload["profileImageUrl"] = profileImageUrl;
  }

  if (updateProfile.backgroundImageUrl) {
    const backgroundImageUrl = await uploadImage(
      "background-image",
      updateProfile.backgroundImageUrl
    ).catch(() => undefined);

    payload["backgroundImageUrl"] = backgroundImageUrl;
  }

  return patchUserProfile(payload);
};

registerEvent("updateProfile", updateProfile);
