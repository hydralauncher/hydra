import { TrashIcon, UploadIcon } from "@primer/octicons-react";
import { MoreVertical } from "lucide-react";
import { Button, ConfirmationModal } from "@renderer/components";
import { createPortal } from "react-dom";
import { useContext, useEffect, useRef, useState } from "react";
import { userProfileContext } from "@renderer/context";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import "./upload-background-image-button.scss";

export function UploadBackgroundImageButton() {
  const [isUploadingBackgroundImage, setIsUploadingBackgorundImage] =
    useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const [showRemoveBannerModal, setShowRemoveBannerModal] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { hasActiveSubscription } = useUserDetails();

  const { t } = useTranslation("user_profile");

  const { isMe, setSelectedBackgroundImage, userProfile, getUserProfile } =
    useContext(userProfileContext);
  const { patchUser, fetchUserDetails } = useUserDetails();

  const { showSuccessToast } = useToast();

  const hasBanner = !!userProfile?.backgroundImageUrl;

  const closeMenu = () => {
    setIsMenuClosing(true);
    setTimeout(() => {
      setIsMenuOpen(false);
      setIsMenuClosing(false);
    }, 150);
  };

  const handleReplaceBanner = async () => {
    closeMenu();
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
        await getUserProfile();
      }
    } finally {
      setIsUploadingBackgorundImage(false);
    }
  };

  const handleRemoveBannerClick = () => {
    closeMenu();
    setShowRemoveBannerModal(true);
  };

  const handleRemoveBannerConfirm = async () => {
    setShowRemoveBannerModal(false);
    try {
      setIsUploadingBackgorundImage(true);
      setSelectedBackgroundImage("");
      await patchUser({ backgroundImageUrl: null });
      showSuccessToast(t("background_image_updated"));
      await fetchUserDetails();
      await getUserProfile();
    } finally {
      setIsUploadingBackgorundImage(false);
    }
  };

  // Handle click outside, scroll, and escape key to close menu
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        closeMenu();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    const handleScroll = () => {
      closeMenu();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isMenuOpen]);

  if (!isMe || !hasActiveSubscription) return null;

  // If no banner exists, show the original upload button
  if (!hasBanner) {
    return (
      <div className="upload-background-image-button__wrapper">
        <Button
          theme="outline"
          className="upload-background-image-button"
          onClick={handleReplaceBanner}
          disabled={isUploadingBackgroundImage}
        >
          <UploadIcon />
          {isUploadingBackgroundImage
            ? t("uploading_banner")
            : t("upload_banner")}
        </Button>
      </div>
    );
  }

  // Calculate menu position
  const getMenuPosition = () => {
    if (!buttonRef.current) return { top: 0, right: 0 };
    const rect = buttonRef.current.getBoundingClientRect();
    return {
      top: rect.bottom + 5,
      right: window.innerWidth - rect.right,
    };
  };

  const menuPosition = isMenuOpen ? getMenuPosition() : { top: 0, right: 0 };

  const menuContent = isMenuOpen && (
    <div
      ref={menuRef}
      className={`upload-background-image-button__menu ${
        isMenuClosing ? "upload-background-image-button__menu--closing" : ""
      }`}
      style={{
        position: "fixed",
        top: `${menuPosition.top}px`,
        right: `${menuPosition.right}px`,
      }}
    >
      <button
        type="button"
        className="upload-background-image-button__menu-item"
        onClick={handleReplaceBanner}
        disabled={isUploadingBackgroundImage}
      >
        <UploadIcon size={16} />
        {t("replace_banner")}
      </button>
      <button
        type="button"
        className="upload-background-image-button__menu-item"
        onClick={handleRemoveBannerClick}
        disabled={isUploadingBackgroundImage}
      >
        <TrashIcon size={16} />
        {t("remove_banner")}
      </button>
    </div>
  );

  return (
    <>
      <div ref={buttonRef} className="upload-background-image-button__wrapper">
        <Button
          theme="outline"
          className="upload-background-image-button"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          disabled={isUploadingBackgroundImage}
        >
          {t("change_banner")}
          <MoreVertical size={16} />
        </Button>
      </div>
      {createPortal(menuContent, document.body)}
      <ConfirmationModal
        visible={showRemoveBannerModal}
        title={t("remove_banner_modal_title")}
        descriptionText={t("remove_banner_confirmation")}
        onClose={() => setShowRemoveBannerModal(false)}
        onConfirm={handleRemoveBannerConfirm}
        cancelButtonLabel={t("cancel")}
        confirmButtonLabel={t("remove")}
        buttonsIsDisabled={isUploadingBackgroundImage}
      />
    </>
  );
}
