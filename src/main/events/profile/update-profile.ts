import { registerEvent } from "../register-event";
import { HydraApi, WindowManager } from "@main/services";
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

  if (updateProfile.profileImageUrl !== undefined) {
    if (updateProfile.profileImageUrl === null) {
      payload["profileImageUrl"] = null;
    } else {
      const profileImageUrl = await uploadImage(
        "profile-image",
        updateProfile.profileImageUrl
      ).catch(() => undefined);

      payload["profileImageUrl"] = profileImageUrl;
    }
  }

  if (updateProfile.backgroundImageUrl !== undefined) {
    if (updateProfile.backgroundImageUrl === null) {
      payload["backgroundImageUrl"] = null;

      /* Mirror the removal to the self-hosted server so its banner
         fallback doesn't resurrect the deleted banner */
      if (HydraApi.isSelfHostedCloudEnabled()) {
        HydraApi.delete("/profile/banner").catch(() => {});
      }
    } else {
      /* Unlike the avatar, a failed banner upload must not be swallowed:
         the banner flow patches nothing else, so silently dropping the
         field would report success while changing nothing. */
      payload["backgroundImageUrl"] = await uploadImage(
        "background-image",
        updateProfile.backgroundImageUrl
      );
    }
  }

  let updatedProfile: UserProfile;

  try {
    updatedProfile = await patchUserProfile(payload);
  } catch (err) {
    /* The official API refuses banner URLs it doesn't host (or the field
       entirely for non-subscribers). The banner already lives on the
       self-hosted server and is displayed through its fallback lookup, so
       save the rest of the profile instead of failing the whole update. */
    const canRetryWithoutBanner =
      HydraApi.isSelfHostedCloudEnabled() &&
      typeof payload["backgroundImageUrl"] === "string";

    if (!canRetryWithoutBanner) throw err;

    updatedProfile = await patchUserProfile(
      omit(payload, ["backgroundImageUrl"])
    );
  }

  // Notify every window (e.g. the friends window, which has its own store) so
  // they can re-fetch the signed-in user's details after a profile change.
  WindowManager.sendToAppWindows("on-profile-updated");

  return updatedProfile;
};

registerEvent("updateProfile", updateProfile);
