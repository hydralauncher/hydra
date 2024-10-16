import { UploadIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useContext, useState } from "react";
import { userProfileContext } from "@renderer/context";

import * as styles from "./upload-background-image-button.css";
import { useToast, useUserDetails } from "@renderer/hooks";

export function UploadBackgroundImageButton() {
  const [isUploadingBackgroundImage, setIsUploadingBackgorundImage] =
    useState(false);

  const { isMe, setSelectedBackgroundImage } = useContext(userProfileContext);
  const { patchUser } = useUserDetails();

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

        showSuccessToast("Background image updated");
      }
    } finally {
      setIsUploadingBackgorundImage(false);
    }
  };

  if (!isMe) return null;

  return (
    <Button
      theme="outline"
      className={styles.uploadBackgroundImageButton}
      onClick={handleChangeCoverClick}
      disabled={isUploadingBackgroundImage}
    >
      <UploadIcon />
      {isUploadingBackgroundImage ? "Uploading..." : "Upload background"}
    </Button>
  );
}
