import { UploadIcon } from "@primer/octicons-react";
import { Button, Modal, ImageCropper, CropArea } from "@renderer/components";
import { useContext, useState } from "react";
import { userProfileContext } from "@renderer/context";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { cropImage } from "@renderer/helpers/image-cropper";
import "./upload-background-image-button.scss";

export function UploadBackgroundImageButton() {
  const [isUploadingBackgroundImage, setIsUploadingBackgorundImage] =
    useState(false);
  const [showCropper, setShowCropper] = useState(false);
  const [selectedImagePath, setSelectedImagePath] = useState<string | null>(
    null
  );
  const { hasActiveSubscription } = useUserDetails();

  const { t } = useTranslation("user_profile");

  const { isMe, setSelectedBackgroundImage } = useContext(userProfileContext);
  const { patchUser, fetchUserDetails } = useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const handleChangeCoverClick = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Image",
          extensions: ["jpg", "jpeg", "png", "gif", "webp"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];
      setSelectedImagePath(path);
      setShowCropper(true);
    }
  };

  const handleCrop = async (cropArea: CropArea) => {
    if (!selectedImagePath) return;

    try {
      setIsUploadingBackgorundImage(true);
      setShowCropper(false);

      const imagePathForCrop = selectedImagePath.startsWith("local:")
        ? selectedImagePath.slice(6)
        : selectedImagePath;
      const imageData = await cropImage(
        imagePathForCrop,
        cropArea,
        "image/png"
      );

      const tempFileName = `cropped-background-${Date.now()}.png`;
      const croppedPath = await window.electron.saveTempFile(
        tempFileName,
        imageData
      );

      setSelectedBackgroundImage(croppedPath);
      await patchUser({ backgroundImageUrl: croppedPath });

      showSuccessToast(t("background_image_updated"));
      await fetchUserDetails();

      setSelectedImagePath(null);
    } catch (error) {
      showErrorToast(t("image_crop_failure"));
    } finally {
      setIsUploadingBackgorundImage(false);
    }
  };

  const handleCancelCrop = () => {
    setShowCropper(false);
    setSelectedImagePath(null);
  };

  if (!isMe || !hasActiveSubscription) return null;

  return (
    <>
      <Button
        theme="outline"
        className="upload-background-image-button"
        onClick={handleChangeCoverClick}
        disabled={isUploadingBackgroundImage}
      >
        <UploadIcon />
        {isUploadingBackgroundImage
          ? t("uploading_banner")
          : t("upload_banner")}
      </Button>

      {showCropper && selectedImagePath && (
        <Modal
          visible={showCropper}
          title={t("crop_background_image")}
          onClose={handleCancelCrop}
          large
        >
          <ImageCropper
            imagePath={selectedImagePath}
            onCrop={handleCrop}
            onCancel={handleCancelCrop}
            aspectRatio={21 / 9}
          />
        </Modal>
      )}
    </>
  );
}
