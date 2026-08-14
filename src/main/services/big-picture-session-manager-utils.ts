import type { UserPreferences } from "@types";

export type BigPictureAudioOperation =
  | { type: "restore" }
  | { type: "set"; deviceId: string };

export function getBigPictureAudioOperation(
  userPreferences: Pick<
    UserPreferences,
    "bigPictureAudioDeviceId" | "bigPictureSoundsEnabled"
  >
): BigPictureAudioOperation {
  if (
    userPreferences.bigPictureSoundsEnabled === false ||
    !userPreferences.bigPictureAudioDeviceId
  ) {
    return { type: "restore" };
  }

  return { type: "set", deviceId: userPreferences.bigPictureAudioDeviceId };
}
