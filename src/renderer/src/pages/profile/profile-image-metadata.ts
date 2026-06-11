import { logger } from "@renderer/logger";

export interface ProfileImageMetadata {
  mimeType: string | null;
  isAnimated: boolean;
}

const ANIMATION_CAPABLE_IMAGE_EXTENSION = /\.(apng|gif|png|webp)$/i;

const canPathBeAnimated = (imagePath: string) => {
  return ANIMATION_CAPABLE_IMAGE_EXTENSION.test(imagePath.split(/[?#]/)[0]);
};

export const getProfileImageMetadata = async (
  imagePath: string
): Promise<ProfileImageMetadata> => {
  try {
    return await window.electron.getProfileImageMetadata(imagePath);
  } catch (error) {
    logger.warn("Failed to get profile image metadata", error);

    return {
      mimeType: null,
      isAnimated: canPathBeAnimated(imagePath),
    };
  }
};
