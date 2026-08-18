import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeClosedIcon,
  EyeIcon,
  HeartFillIcon,
  HeartIcon,
  ImageIcon,
  TrophyIcon,
  XIcon,
} from "@primer/octicons-react";
import { TrashIcon } from "lucide-react";

import { ConfirmationModal, Link } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate } from "@renderer/hooks";
import { getSouvenirVisualVariant } from "@shared";
import type { ProfileAchievement } from "@types";

import "./souvenir-lightbox.scss";

interface SouvenirLightboxProps {
  souvenir: ProfileAchievement | null;
  items: ProfileAchievement[];
  index: number;
  isOwner: boolean;
  canLike: boolean;
  isLiking: boolean;
  isUpdatingVisibility: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onLike: (souvenir: ProfileAchievement) => void;
  onVisibilityChange: (souvenir: ProfileAchievement) => void;
  onDelete: (souvenir: ProfileAchievement) => Promise<boolean>;
}

const hideBrokenImage = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.style.opacity = "0";
};

const souvenirSlideVariants = {
  enter: (direction: number) =>
    direction === 0
      ? { opacity: 1, x: 0 }
      : { opacity: 1, x: `${direction * 100}%` },
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 1, x: `${direction * -100}%` }),
};

interface LoadedImage {
  naturalWidth: number;
  naturalHeight: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

const getLightboxImageSize = (
  loadedImage: LoadedImage | null,
  viewportSize: ViewportSize
) => {
  if (!loadedImage) return null;

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
  onGameClick,
}: Readonly<{
  souvenir: ProfileAchievement;
  onGameClick: () => void;
}>) {
  const { t } = useTranslation("user_profile");
  const { formatDateTime } = useDate();
  const visualVariant = getSouvenirVisualVariant(souvenir);
  const gameTitle = souvenir.gameTitle ?? t("unknown_game");
  const gamePath = buildGameDetailsPath({
    shop: souvenir.shop,
    objectId: souvenir.objectId,
    title: gameTitle,
  });

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
            <Link
              className="profile-souvenir-lightbox__game-link"
              to={gamePath}
              onClick={onGameClick}
            >
              {gameTitle}
            </Link>
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
  items,
  index,
  isOwner,
  canLike,
  isLiking,
  isUpdatingVisibility,
  isDeleting,
  onClose,
  onNavigate,
  onLike,
  onVisibilityChange,
  onDelete,
}: Readonly<SouvenirLightboxProps>) {
  const { t } = useTranslation(["user_profile", "modal", "game_details"]);
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [navigationDirection, setNavigationDirection] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const pendingLoadedImageRef = useRef<LoadedImage | null>(null);
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;
  const handleNavigate = useCallback(
    (nextIndex: number) => {
      if (isNavigating) return;

      setIsNavigating(true);
      setNavigationDirection(nextIndex > index ? 1 : -1);
      onNavigate(nextIndex);
    },
    [index, isNavigating, onNavigate]
  );

  useEffect(() => {
    if (!souvenir) {
      setIsDeleteConfirmationVisible(false);
      setNavigationDirection(0);
      setIsNavigating(false);
      pendingLoadedImageRef.current = null;
    }
  }, [souvenir]);

  useEffect(() => {
    const neighboringSouvenirs = [items[index - 1], items[index + 1]];

    for (const neighboringSouvenir of neighboringSouvenirs) {
      if (!neighboringSouvenir?.imageUrl) continue;

      const image = new Image();
      image.src = neighboringSouvenir.imageUrl;
    }
  }, [index, items]);

  useEffect(() => {
    if (!souvenir || isDeleteConfirmationVisible) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft" && hasPrevious) {
        handleNavigate(index - 1);
      } else if (event.key === "ArrowRight" && hasNext) {
        handleNavigate(index + 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    hasNext,
    hasPrevious,
    handleNavigate,
    index,
    isDeleteConfirmationVisible,
    onClose,
    souvenir,
  ]);

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
  const showImagePlaceholder = !hasImage || !loadedImage;
  const imageSize = getLightboxImageSize(loadedImage, viewportSize);

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!souvenir.imageUrl || !naturalWidth || !naturalHeight) return;

    const nextLoadedImage = {
      naturalWidth,
      naturalHeight,
    };

    if (isNavigating) {
      pendingLoadedImageRef.current = nextLoadedImage;
      return;
    }

    setLoadedImage(nextLoadedImage);
  };

  const handleNavigationAnimationComplete = () => {
    if (pendingLoadedImageRef.current) {
      setLoadedImage(pendingLoadedImageRef.current);
      pendingLoadedImageRef.current = null;
    }

    setIsNavigating(false);
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
        <dialog
          className="profile-souvenir-lightbox"
          open
          aria-label={souvenir.displayName}
        >
          <button
            type="button"
            className="profile-souvenir-lightbox__backdrop-button"
            onClick={onClose}
            disabled={isNavigating}
            aria-label={t("close", { ns: "modal" })}
          />

          <button
            type="button"
            className="profile-souvenir-lightbox__close-button"
            onClick={onClose}
            aria-label={t("close", { ns: "modal" })}
          >
            <XIcon size={24} />
          </button>

          <button
            type="button"
            className={`profile-souvenir-lightbox__nav-button profile-souvenir-lightbox__nav-button--left ${
              !hasPrevious
                ? "profile-souvenir-lightbox__nav-button--hidden"
                : ""
            }`}
            onClick={() => handleNavigate(index - 1)}
            disabled={!hasPrevious || isNavigating}
            aria-label={t("previous_media", { ns: "game_details" })}
          >
            <ChevronLeftIcon size={28} />
          </button>

          <button
            type="button"
            className={`profile-souvenir-lightbox__nav-button profile-souvenir-lightbox__nav-button--right ${
              !hasNext ? "profile-souvenir-lightbox__nav-button--hidden" : ""
            }`}
            onClick={() => handleNavigate(index + 1)}
            disabled={!hasNext || isNavigating}
            aria-label={t("next_media", { ns: "game_details" })}
          >
            <ChevronRightIcon size={28} />
          </button>

          <div
            className={`profile-souvenir-lightbox__stage${
              isNavigating
                ? " profile-souvenir-lightbox__stage--navigating"
                : ""
            }`}
          >
            <AnimatePresence initial={false} custom={navigationDirection}>
              <motion.div
                key={`${souvenir.gameId}:${souvenir.name}`}
                className="profile-souvenir-lightbox__slide"
                custom={navigationDirection}
                variants={souvenirSlideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
                onAnimationComplete={handleNavigationAnimationComplete}
              >
                <div className="profile-souvenir-lightbox__content">
                  <SouvenirImage
                    souvenir={souvenir}
                    hasImage={hasImage}
                    showImagePlaceholder={showImagePlaceholder}
                    imageSize={imageSize}
                    onLoad={handleImageLoad}
                    onError={() => setFailedImageUrl(souvenir.imageUrl)}
                  />

                  <section className="profile-souvenir-lightbox__info">
                    <SouvenirSummary
                      souvenir={souvenir}
                      onGameClick={onClose}
                    />
                    <SouvenirActions
                      souvenir={souvenir}
                      isOwner={isOwner}
                      canLike={canLike}
                      isLiking={isLiking}
                      isUpdatingVisibility={isUpdatingVisibility}
                      isDeleting={isDeleting}
                      onLike={onLike}
                      onVisibilityChange={onVisibilityChange}
                      onRequestDelete={() =>
                        setIsDeleteConfirmationVisible(true)
                      }
                    />
                  </section>
                </div>
              </motion.div>
            </AnimatePresence>
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
