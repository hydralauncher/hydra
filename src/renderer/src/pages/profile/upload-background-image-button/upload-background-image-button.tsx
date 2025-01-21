import { UploadIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useContext, useState } from "react";
import { userProfileContext } from "@renderer/context";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import "./upload-background-image-button.scss";

export function UploadBackgroundImageButton() {
  const [isUploadingBackgroundImage, setIsUploadingBackgorundImage] =
    useState(false);
  const { hasActiveSubscription } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const { isMe, setSelectedBackgroundImage } = useContext(userProfileContext);
  const { patchUser, fetchUserDetails } = useUserDetails();
  const { showSuccessToast } = useToast();

  const handleChangeCoverClick = async () => {
    try {
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

        setSelectedBackgroundImage(path);
        setIsUploadingBackgorundImage(true);

        await patchUser({ backgroundImageUrl: path });

        showSuccessToast(t("background_image_updated"));
        await fetchUserDetails();
      }
    } finally {
      setIsUploadingBackgorundImage(false);
    }
  };

  if (!isMe || !hasActiveSubscription) return null;

  return (
    <Button
      theme="outline"
      className="upload-background-image-button"
      onClick={handleChangeCoverClick}
      disabled={isUploadingBackgroundImage}
    >
      <UploadIcon />
      {isUploadingBackgroundImage ? t("uploading_banner") : t("upload_banner")}
    </Button>
  );
}
