import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast, useUserDetails } from "@renderer/hooks";
import { getProfileImageMetadata } from "../profile-image-metadata";

export type ProfileImageVariant = "avatar" | "banner";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "apng", "gif", "webp"];

interface CropRequest {
  variant: ProfileImageVariant;
  path: string;
  isAnimated: boolean;
}

/**
 * Opens the file dialog and sends the chosen image through the crop modal.
 * Animated photos keep their animation only with Hydra Cloud; banners are
 * Hydra Cloud only, so they always keep it.
 */
export function useProfileImagePicker(
  onCropped: (variant: ProfileImageVariant, croppedPath: string) => void
) {
  const { t } = useTranslation("user_profile");
  const { showErrorToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const [cropRequest, setCropRequest] = useState<CropRequest | null>(null);

  const pickImage = useCallback(
    async (variant: ProfileImageVariant) => {
      const { filePaths } = await window.electron.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "Image", extensions: IMAGE_EXTENSIONS }],
      });

      const path = filePaths?.[0];
      if (!path) return;

      const metadata = await getProfileImageMetadata(path);

      if (
        metadata.isAnimated &&
        variant === "avatar" &&
        !hasActiveSubscription
      ) {
        const { imagePath } = await window.electron
          .processProfileImage(path)
          .catch(() => {
            showErrorToast(t("image_process_failure"));
            return { imagePath: null };
          });

        if (imagePath) {
          setCropRequest({ variant, path: imagePath, isAnimated: false });
        }
        return;
      }

      // Crop while preserving animation (handled in main/sharp).
      setCropRequest({ variant, path, isAnimated: metadata.isAnimated });
    },
    [hasActiveSubscription, showErrorToast, t]
  );

  const cropModalProps = {
    visible: !!cropRequest,
    imagePath: cropRequest?.path ?? null,
    variant: cropRequest?.variant ?? "avatar",
    isAnimated: cropRequest?.isAnimated ?? false,
    onClose: () => setCropRequest(null),
    onApply: (croppedPath: string) => {
      if (cropRequest) onCropped(cropRequest.variant, croppedPath);
      setCropRequest(null);
    },
  };

  return { pickImage, cropModalProps };
}
