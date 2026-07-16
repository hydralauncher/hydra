import { useTranslation } from "react-i18next";
import { ImageCropModal } from "@renderer/components";

type CropVariant = "avatar" | "banner";

interface ProfileImageCropModalProps {
  visible: boolean;
  imagePath: string | null;
  variant: CropVariant;
  isAnimated?: boolean;
  onClose: () => void;
  onApply: (croppedImagePath: string) => void;
}

const CROP_OUTPUT_SIZE: Record<CropVariant, { width: number; height: number }> =
  {
    avatar: { width: 512, height: 512 },
    banner: { width: 1600, height: 400 },
  };

export function ProfileImageCropModal({
  visible,
  imagePath,
  variant,
  onClose,
  onApply,
}: ProfileImageCropModalProps) {
  const { t } = useTranslation("user_profile");
  const outputSize = CROP_OUTPUT_SIZE[variant];

  return (
    <ImageCropModal
      visible={visible}
      imagePath={imagePath}
      outputWidth={outputSize.width}
      outputHeight={outputSize.height}
      title={
        variant === "avatar"
          ? t("crop_profile_picture")
          : t("crop_profile_banner")
      }
      description={t("crop_profile_image_description")}
      stageLabel={t("crop_profile_image_stage")}
      errorMessage={t("image_process_failure")}
      labels={{
        apply: t("apply_crop"),
        applying: t("applying_crop"),
        cancel: t("cancel"),
        reset: t("reset"),
        rotate: t("rotate"),
        toggleGrid: t("toggle_grid"),
        zoom: t("zoom"),
        zoomIn: t("zoom_in"),
        zoomOut: t("zoom_out"),
      }}
      onClose={onClose}
      onApply={onApply}
    />
  );
}
