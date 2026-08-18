import { useEffect, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  EyeClosedIcon,
  EyeIcon,
  HeartFillIcon,
  HeartIcon,
  ImageIcon,
  TrophyIcon,
  XIcon,
} from "@primer/octicons-react";
import { TrashIcon } from "lucide-react";

import { ConfirmationModal } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import { getSouvenirVisualVariant } from "@shared";
import type { ProfileAchievement } from "@types";

import "./souvenir-lightbox.scss";

interface SouvenirLightboxProps {
  souvenir: ProfileAchievement | null;
  isOwner: boolean;
  canLike: boolean;
  isLiking: boolean;
  isUpdatingVisibility: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onLike: (souvenir: ProfileAchievement) => void;
  onVisibilityChange: (souvenir: ProfileAchievement) => void;
  onDelete: (souvenir: ProfileAchievement) => Promise<boolean>;
}

const hideBrokenImage = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.style.opacity = "0";
};

interface LoadedImage {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

const getLightboxImageSize = (
  loadedImage: LoadedImage | null,
  imageUrl: string | null,
  viewportSize: ViewportSize
) => {
  if (loadedImage?.imageUrl !== imageUrl) return null;

  const maxWidth = viewportSize.width * 0.9;
  const reservedInfoHeight = viewportSize.width <= 900 ? 200 : 136;
  const maxHeight = Math.max(viewportSize.height * 0.9 - reservedInfoHeight, 1);
  const scale = Math.min(
    maxWidth / loadedImage.naturalWidth,
    maxHeight / loadedImage.naturalHeight
  );

  return {
    width: loadedImage.naturalWidth * scale,
    height: loadedImage.naturalHeight * scale,
  };
};

interface SouvenirImageProps {
  souvenir: ProfileAchievement;
  hasImage: boolean;
  showImagePlaceholder: boolean;
  imageSize: ReturnType<typeof getLightboxImageSize>;
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError: () => void;
}

function SouvenirImage({
  souvenir,
  hasImage,
  showImagePlaceholder,
  imageSize,
  onLoad,
  onError,
}: Readonly<SouvenirImageProps>) {
  const imageFrameClassName = showImagePlaceholder
    ? "profile-souvenir-lightbox__image-frame profile-souvenir-lightbox__image-frame--placeholder"
    : "profile-souvenir-lightbox__image-frame";

  return (
    <div className={imageFrameClassName} style={imageSize ?? undefined}>
      <span className="profile-souvenir-lightbox__image-placeholder">
        <ImageIcon size={56} />
      </span>

      {hasImage ? (
        <img
          className="profile-souvenir-lightbox__image"
          src={souvenir.imageUrl ?? undefined}
          alt={souvenir.displayName}
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function SouvenirSummary({
  souvenir,
}: Readonly<{ souvenir: ProfileAchievement }>) {
  const { t } = useTranslation("user_profile");
  const { formatDateTime } = useDate();
  const visualVariant = getSouvenirVisualVariant(souvenir);

  return (
    <div className="profile-souvenir-lightbox__summary">
      <span className="profile-souvenir-lightbox__achievement-icon">
        <TrophyIcon size={24} />
        {souvenir.achievementIcon ? (
          <img
            src={souvenir.achievementIcon}
            alt=""
            onError={hideBrokenImage}
          />
        ) : null}
      </span>

      <div className="profile-souvenir-lightbox__copy">
        <div className="profile-souvenir-lightbox__title-row">
          <h2>{souvenir.displayName}</h2>
          {visualVariant ? (
            <span
              className={`profile-souvenir-lightbox__rarity profile-souvenir-lightbox__rarity--${visualVariant}`}
            >
              <TrophyIcon size={12} />
              {t(`${visualVariant}_souvenir`)}
            </span>
          ) : null}
        </div>

        {souvenir.description ? <p>{souvenir.description}</p> : null}

        <div className="profile-souvenir-lightbox__meta">
          <span className="profile-souvenir-lightbox__game">
            <span className="profile-souvenir-lightbox__game-icon">
              <ImageIcon size={14} />
              {souvenir.gameIconUrl ? (
                <img
                  src={souvenir.gameIconUrl}
                  alt=""
                  onError={hideBrokenImage}
                />
              ) : null}
            </span>
            {souvenir.gameTitle ?? t("unknown_game")}
          </span>

          <span
            className="profile-souvenir-lightbox__meta-separator"
            aria-hidden="true"
          />

          <span className="profile-souvenir-lightbox__unlock-time">
            {t("souvenir_unlocked_on", {
              date: formatDateTime(souvenir.unlockTime),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

interface SouvenirActionsProps {
  souvenir: ProfileAchievement;
  isOwner: boolean;
  canLike: boolean;
  isLiking: boolean;
  isUpdatingVisibility: boolean;
  isDeleting: boolean;
  onLike: (souvenir: ProfileAchievement) => void;
  onVisibilityChange: (souvenir: ProfileAchievement) => void;
  onRequestDelete: () => void;
}

function SouvenirActions({
  souvenir,
  isOwner,
  canLike,
  isLiking,
  isUpdatingVisibility,
  isDeleting,
  onLike,
  onVisibilityChange,
  onRequestDelete,
}: Readonly<SouvenirActionsProps>) {
  const { t } = useTranslation("user_profile");
  const isPrivate = souvenir.visibility === "PRIVATE";
  const visibilityTitleKey = isPrivate
    ? "show_souvenir_on_profile"
    : "hide_souvenir_from_profile";
  const visibilityLabelKey = isPrivate ? "show_souvenir" : "hide_souvenir";
  const LikeIcon = souvenir.likedByMe ? HeartFillIcon : HeartIcon;
  const VisibilityIcon = isPrivate ? EyeClosedIcon : EyeIcon;
  const likeButtonClassName = [
    "profile-souvenir-lightbox__action",
    souvenir.likedByMe ? "profile-souvenir-lightbox__action--active" : "",
    isLiking ? "profile-souvenir-lightbox__action--pending" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="profile-souvenir-lightbox__actions">
      <button
        type="button"
        className={likeButtonClassName}
        onClick={() => onLike(souvenir)}
        disabled={isLiking}
        title={canLike ? t("like_souvenir") : t("sign_in_to_like_souvenir")}
        aria-pressed={souvenir.likedByMe}
      >
        <LikeIcon size={16} />
        <span>{souvenir.likeCount}</span>
      </button>

      {isOwner ? (
        <>
          <button
            type="button"
            className="profile-souvenir-lightbox__action"
            onClick={() => onVisibilityChange(souvenir)}
            disabled={isUpdatingVisibility}
            aria-label={t(visibilityTitleKey)}
            title={t(visibilityTitleKey)}
          >
            <VisibilityIcon size={16} />
            <span>{t(visibilityLabelKey)}</span>
          </button>

          <button
            type="button"
            className="profile-souvenir-lightbox__action profile-souvenir-lightbox__action--delete profile-souvenir-lightbox__action--icon"
            onClick={onRequestDelete}
            disabled={isDeleting}
            aria-label={t("delete_souvenir")}
            title={t("delete_souvenir")}
          >
            <TrashIcon size={16} />
          </button>
        </>
      ) : null}
    </div>
  );
}

export function SouvenirLightbox({
  souvenir,
  isOwner,
  canLike,
  isLiking,
  isUpdatingVisibility,
  isDeleting,
  onClose,
  onLike,
  onVisibilityChange,
  onDelete,
}: Readonly<SouvenirLightboxProps>) {
  const { t } = useTranslation(["user_profile", "modal"]);
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    if (!souvenir) setIsDeleteConfirmationVisible(false);
  }, [souvenir]);

  useEffect(() => {
    if (!souvenir || isDeleteConfirmationVisible) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDeleteConfirmationVisible, onClose, souvenir]);

  useEffect(() => {
    const onResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!souvenir) return null;

  const hasImage = Boolean(
    souvenir.imageUrl && souvenir.imageUrl !== failedImageUrl
  );
  const showImagePlaceholder =
    !hasImage || loadedImage?.imageUrl !== souvenir.imageUrl;
  const imageSize = getLightboxImageSize(
    loadedImage,
    souvenir.imageUrl,
    viewportSize
  );

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!souvenir.imageUrl || !naturalWidth || !naturalHeight) return;

    setLoadedImage({
      imageUrl: souvenir.imageUrl,
      naturalWidth,
      naturalHeight,
    });
  };

  const handleDeleteConfirm = async () => {
    const wasDeleted = await onDelete(souvenir);
    if (!wasDeleted) return;

    setIsDeleteConfirmationVisible(false);
    onClose();
  };

  return createPortal(
    <>
      <div className="profile-souvenir-lightbox__overlay">
        <button
          type="button"
          className="profile-souvenir-lightbox__backdrop-button"
          onClick={onClose}
          aria-label={t("close", { ns: "modal" })}
        />

        <dialog
          className="profile-souvenir-lightbox"
          open
          aria-label={souvenir.displayName}
        >
          <div className="profile-souvenir-lightbox__content">
            <button
              type="button"
              className="profile-souvenir-lightbox__close-button"
              onClick={onClose}
              aria-label={t("close", { ns: "modal" })}
            >
              <XIcon size={24} />
            </button>

            <SouvenirImage
              souvenir={souvenir}
              hasImage={hasImage}
              showImagePlaceholder={showImagePlaceholder}
              imageSize={imageSize}
              onLoad={handleImageLoad}
              onError={() => setFailedImageUrl(souvenir.imageUrl)}
            />

            <section className="profile-souvenir-lightbox__info">
              <SouvenirSummary souvenir={souvenir} />
              <SouvenirActions
                souvenir={souvenir}
                isOwner={isOwner}
                canLike={canLike}
                isLiking={isLiking}
                isUpdatingVisibility={isUpdatingVisibility}
                isDeleting={isDeleting}
                onLike={onLike}
                onVisibilityChange={onVisibilityChange}
                onRequestDelete={() => setIsDeleteConfirmationVisible(true)}
              />
            </section>
          </div>
        </dialog>
      </div>

      <ConfirmationModal
        visible={isDeleteConfirmationVisible}
        title={t("delete_souvenir_modal_title")}
        descriptionText={t("delete_souvenir_modal_description")}
        confirmButtonLabel={t("delete_souvenir_modal_delete_button")}
        cancelButtonLabel={t("delete_souvenir_modal_cancel_button")}
        confirmButtonTheme="danger"
        onConfirm={handleDeleteConfirm}
        onClose={() => setIsDeleteConfirmationVisible(false)}
      />
    </>,
    document.body
  );
}
