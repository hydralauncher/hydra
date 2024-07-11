import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import { UserProfile } from "@types";

const patchUserProfile = async (
  displayName: string,
  profileImageUrl?: string
) => {
  if (profileImageUrl) {
    return HydraApi.patch("/profile", {
      displayName,
      profileImageUrl,
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
) => {
  if (!newProfileImagePath) {
    return patchUserProfile(displayName).then(
      (response) => response as UserProfile
    );
  }

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
      return profileImageUrl;
    })
    .catch(() => undefined);

  return patchUserProfile(displayName, profileImageUrl).then(
    (response) => response as UserProfile
  );
};

registerEvent("updateProfile", updateProfile);
