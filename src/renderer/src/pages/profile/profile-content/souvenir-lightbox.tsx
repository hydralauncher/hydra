import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
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
  ReportIcon,
  TrophyIcon,
  XIcon,
} from "@primer/octicons-react";
import { TrashIcon } from "lucide-react";
import { Tooltip } from "react-tooltip";

import { ConfirmationModal, Link } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate } from "@renderer/hooks";
import {
  AuthPage,
  getPrimarySouvenirAchievement,
  getSouvenirVisualVariant,
} from "@shared";
import type {
  ProfileSouvenir,
  ProfileSouvenirAchievement,
  SouvenirReportValues,
} from "@types";
import { SouvenirReportModal } from "./souvenir-report-modal";

import "./souvenir-lightbox.scss";

const LIKE_ANIMATION_DURATION_MS = 400;

interface SouvenirLightboxProps {
  souvenir: ProfileSouvenir | null;
  items: ProfileSouvenir[];
  index: number;
  isOwner: boolean;
  canLike: boolean;
  isLiking: boolean;
  isUpdatingVisibility: boolean;
  isDeleting: boolean;
  isReporting: boolean;
  isReported: boolean;
  isContentWarningVisible: boolean;
  onClose: () => void;
  onNavigate: (index: number) => boolean;
  onLike: (souvenir: ProfileSouvenir) => void;
  onVisibilityChange: (souvenir: ProfileSouvenir) => void;
  onDelete: (souvenir: ProfileSouvenir) => Promise<boolean>;
  onReport: (
    souvenir: ProfileSouvenir,
    values: SouvenirReportValues
  ) => Promise<boolean>;
}

const souvenirSlideVariants = {
  enter: (direction: number) =>
    direction === 0
      ? { opacity: 1, x: 0 }
      : { opacity: 1, x: `${direction * 100}%` },
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 1, x: `${direction * -100}%` }),
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
  const reservedInfoHeight = getReservedInfoHeight(viewportSize);
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

const getReservedInfoHeight = (viewportSize: ViewportSize) =>
  viewportSize.width <= 900 ? 260 : 196;

interface SouvenirImageProps {
  souvenir: ProfileSouvenir;
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
  const primaryAchievement = getPrimarySouvenirAchievement(souvenir);
  const imageFrameClassName = showImagePlaceholder
    ? "profile-souvenir-lightbox__image-frame profile-souvenir-lightbox__image-frame--placeholder"
    : "profile-souvenir-lightbox__image-frame";

  return (
    <div className={imageFrameClassName} style={imageSize ?? undefined}>
      {showImagePlaceholder ? (
        <span className="profile-souvenir-lightbox__image-placeholder">
          <ImageIcon size={56} />
        </span>
      ) : null}

      {hasImage ? (
        <img
          className="profile-souvenir-lightbox__image"
          src={souvenir.imageUrl ?? undefined}
          alt={primaryAchievement.displayName}
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
  souvenir: ProfileSouvenir;
  onGameClick: () => void;
}>) {
  const { t } = useTranslation("user_profile");
  const { formatDateTime } = useDate();
  const additionalAchievementsTooltipId = useId();
  const [failedAchievementIconUrl, setFailedAchievementIconUrl] = useState<
    string | null
  >(null);
  const [failedGameIconUrl, setFailedGameIconUrl] = useState<string | null>(
    null
  );
  const primaryAchievement = getPrimarySouvenirAchievement(souvenir);
  const additionalAchievements = souvenir.achievements.filter(
    (achievement) =>
      achievement.name.toUpperCase() !== primaryAchievement.name.toUpperCase()
  );
  const visualVariant = getSouvenirVisualVariant(primaryAchievement);
  const gameTitle = souvenir.gameTitle ?? t("unknown_game");
  const gamePath = buildGameDetailsPath({
    shop: souvenir.shop,
    objectId: souvenir.objectId,
    title: gameTitle,
  });
  const hasAchievementIcon = Boolean(
    primaryAchievement.achievementIcon &&
      primaryAchievement.achievementIcon !== failedAchievementIconUrl
  );
  const hasGameIcon = Boolean(
    souvenir.gameIconUrl && souvenir.gameIconUrl !== failedGameIconUrl
  );

  return (
    <div className="profile-souvenir-lightbox__summary">
      <span className="profile-souvenir-lightbox__achievement-icon">
        {hasAchievementIcon ? (
          <img
            src={primaryAchievement.achievementIcon ?? undefined}
            alt=""
            onError={() =>
              setFailedAchievementIconUrl(primaryAchievement.achievementIcon)
            }
          />
        ) : (
          <TrophyIcon size={24} />
        )}
      </span>

      <div className="profile-souvenir-lightbox__copy">
        <div className="profile-souvenir-lightbox__title-row">
          <h2 title={primaryAchievement.displayName}>
            {primaryAchievement.displayName}
          </h2>
          {additionalAchievements.length > 0 ? (
            <>
              <button
                type="button"
                className="profile-souvenir-lightbox__other-count"
                data-tooltip-id={additionalAchievementsTooltipId}
              >
                {t("souvenir_other_achievements", {
                  count: additionalAchievements.length,
                })}
              </button>
              <Tooltip
                id={additionalAchievementsTooltipId}
                place="top"
                positionStrategy="fixed"
                clickable
                delayHide={100}
                className="profile-souvenir-lightbox__achievement-tooltip"
              >
                <ul className="profile-souvenir-lightbox__achievement-list">
                  {additionalAchievements.map((achievement) => (
                    <SouvenirAchievementListItem
                      key={achievement.name}
                      achievement={achievement}
                    />
                  ))}
                </ul>
              </Tooltip>
            </>
          ) : null}
          {visualVariant ? (
            <span
              className={`profile-souvenir-lightbox__rarity profile-souvenir-lightbox__rarity--${visualVariant}`}
            >
              <TrophyIcon size={12} />
              {t(`${visualVariant}_souvenir`)}
            </span>
          ) : null}
        </div>

        {primaryAchievement.description ? (
          <p title={primaryAchievement.description}>
            {primaryAchievement.description}
          </p>
        ) : null}

        <div className="profile-souvenir-lightbox__meta">
          <span className="profile-souvenir-lightbox__game">
            <Link
              className="profile-souvenir-lightbox__game-link"
              to={gamePath}
              onClick={onGameClick}
            >
              <span className="profile-souvenir-lightbox__game-icon">
                {hasGameIcon ? (
                  <img
                    src={souvenir.gameIconUrl ?? undefined}
                    alt=""
                    onError={() => setFailedGameIconUrl(souvenir.gameIconUrl)}
                  />
                ) : (
                  <ImageIcon size={14} />
                )}
              </span>
              <span className="profile-souvenir-lightbox__game-name">
                {gameTitle}
              </span>
            </Link>
          </span>

          <span
            className="profile-souvenir-lightbox__meta-separator"
            aria-hidden="true"
          />

          <span className="profile-souvenir-lightbox__unlock-time">
            {t("souvenir_unlocked_on", {
              date: formatDateTime(primaryAchievement.unlockTime),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

function SouvenirAchievementListItem({
  achievement,
}: Readonly<{ achievement: ProfileSouvenirAchievement }>) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const hasIcon = Boolean(
    achievement.achievementIcon && achievement.achievementIcon !== failedIconUrl
  );

  return (
    <li className="profile-souvenir-lightbox__achievement-list-item">
      <span className="profile-souvenir-lightbox__achievement-list-icon">
        {hasIcon ? (
          <img
            src={achievement.achievementIcon ?? undefined}
            alt=""
            onError={() => setFailedIconUrl(achievement.achievementIcon)}
          />
        ) : (
          <TrophyIcon size={14} />
        )}
      </span>
      <span className="profile-souvenir-lightbox__achievement-list-copy">
        <strong title={achievement.displayName}>
          {achievement.displayName}
        </strong>
        {achievement.description ? (
          <small title={achievement.description}>
            {achievement.description}
          </small>
        ) : null}
      </span>
    </li>
  );
}

interface SouvenirActionsProps {
  souvenir: ProfileSouvenir;
  isOwner: boolean;
  canLike: boolean;
  isLiking: boolean;
  isUpdatingVisibility: boolean;
  isDeleting: boolean;
  isReporting: boolean;
  isReported: boolean;
  onLike: (souvenir: ProfileSouvenir) => void;
  onVisibilityChange: (souvenir: ProfileSouvenir) => void;
  onRequestDelete: () => void;
  onRequestReport: () => void;
}

function SouvenirActions({
  souvenir,
  isOwner,
  canLike,
  isLiking,
  isUpdatingVisibility,
  isDeleting,
  isReporting,
  isReported,
  onLike,
  onVisibilityChange,
  onRequestDelete,
  onRequestReport,
}: Readonly<SouvenirActionsProps>) {
  const { t } = useTranslation("user_profile");
  const [isLikeAnimating, setIsLikeAnimating] = useState(false);
  const isPrivate = souvenir.visibility === "PRIVATE";
  const visibilityTitleKey = isPrivate
    ? "show_souvenir_on_profile"
    : "hide_souvenir_from_profile";
  const visibilityLabelKey = isPrivate ? "show_souvenir" : "hide_souvenir";
  const LikeIcon = souvenir.likedByMe ? HeartFillIcon : HeartIcon;
  const VisibilityIcon = isPrivate ? EyeClosedIcon : EyeIcon;
  const isLikeDisabled = isLiking || isLikeAnimating;
  const likeButtonClassName = [
    "profile-souvenir-lightbox__action",
    souvenir.likedByMe ? "profile-souvenir-lightbox__action--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!isLikeAnimating) return;

    const timeoutId = window.setTimeout(
      () => setIsLikeAnimating(false),
      LIKE_ANIMATION_DURATION_MS
    );

    return () => window.clearTimeout(timeoutId);
  }, [isLikeAnimating]);

  const handleLikeClick = () => {
    if (isLikeDisabled) return;
    setIsLikeAnimating(true);
    onLike(souvenir);
  };

  return (
    <div className="profile-souvenir-lightbox__actions">
      <motion.button
        type="button"
        className={likeButtonClassName}
        onClick={handleLikeClick}
        disabled={isLikeDisabled}
        title={canLike ? t("like_souvenir") : t("sign_in_to_like_souvenir")}
        aria-pressed={souvenir.likedByMe}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <LikeIcon size={16} />
        <AnimatePresence mode="wait">
          <motion.span
            key={souvenir.likeCount}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
          >
            {souvenir.likeCount}
          </motion.span>
        </AnimatePresence>
      </motion.button>

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
      ) : (
        <button
          type="button"
          className="profile-souvenir-lightbox__action"
          onClick={onRequestReport}
          disabled={isReporting || isReported}
          aria-label={t(isReported ? "souvenir_reported" : "report_souvenir")}
          title={t(isReported ? "souvenir_reported" : "report_souvenir")}
        >
          <ReportIcon size={16} />
          <span>{t(isReported ? "reported" : "report")}</span>
        </button>
      )}
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
  isReporting,
  isReported,
  isContentWarningVisible,
  onClose,
  onNavigate,
  onLike,
  onVisibilityChange,
  onDelete,
  onReport,
}: Readonly<SouvenirLightboxProps>) {
  const { t } = useTranslation(["user_profile", "modal", "game_details"]);
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [navigationDirection, setNavigationDirection] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const loadedImagesRef = useRef(new Map<string, LoadedImage>());
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;
  const isBlockingModalVisible =
    isDeleteConfirmationVisible ||
    isReportModalVisible ||
    isContentWarningVisible;
  const handleNavigate = useCallback(
    (nextIndex: number) => {
      if (isNavigating) return;

      if (!onNavigate(nextIndex)) return;

      const nextImageUrl = items[nextIndex]?.imageUrl;
      setLoadedImage(
        nextImageUrl
          ? (loadedImagesRef.current.get(nextImageUrl) ?? null)
          : null
      );
      setIsNavigating(true);
      setNavigationDirection(nextIndex > index ? 1 : -1);
    },
    [index, isNavigating, items, onNavigate]
  );

  useEffect(() => {
    if (!souvenir) {
      setIsDeleteConfirmationVisible(false);
      setIsReportModalVisible(false);
      setNavigationDirection(0);
      setIsNavigating(false);
    }
  }, [souvenir]);

  useEffect(() => {
    if (!isContentWarningVisible) return;

    setNavigationDirection(0);
    setIsNavigating(false);
  }, [isContentWarningVisible]);

  useEffect(() => {
    const neighboringSouvenirs = [items[index - 1], items[index + 1]];

    for (const neighboringSouvenir of neighboringSouvenirs) {
      const imageUrl = neighboringSouvenir?.imageUrl;
      if (!imageUrl || loadedImagesRef.current.has(imageUrl)) continue;

      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) return;

        loadedImagesRef.current.set(imageUrl, {
          imageUrl,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        });
      };
      image.src = imageUrl;
    }
  }, [index, items]);

  useEffect(() => {
    if (!souvenir || isBlockingModalVisible) return;

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
    isBlockingModalVisible,
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

  const primaryAchievement = getPrimarySouvenirAchievement(souvenir);

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
  const contentStyle = {
    "--souvenir-info-height": `${getReservedInfoHeight(viewportSize)}px`,
  } as CSSProperties;

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!souvenir.imageUrl || !naturalWidth || !naturalHeight) return;

    const nextLoadedImage = {
      imageUrl: souvenir.imageUrl,
      naturalWidth,
      naturalHeight,
    };

    loadedImagesRef.current.set(souvenir.imageUrl, nextLoadedImage);
    setLoadedImage(nextLoadedImage);
  };

  const handleNavigationAnimationComplete = () => {
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
          aria-label={primaryAchievement.displayName}
        >
          <button
            type="button"
            className="profile-souvenir-lightbox__backdrop-button"
            onClick={onClose}
            disabled={isNavigating || isBlockingModalVisible}
            aria-label={t("close", { ns: "modal" })}
          />

          <button
            type="button"
            className="profile-souvenir-lightbox__close-button"
            onClick={onClose}
            disabled={isContentWarningVisible}
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
            disabled={!hasPrevious || isNavigating || isContentWarningVisible}
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
            disabled={!hasNext || isNavigating || isContentWarningVisible}
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
                key={souvenir.id}
                className="profile-souvenir-lightbox__slide"
                custom={navigationDirection}
                variants={souvenirSlideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
                onAnimationComplete={handleNavigationAnimationComplete}
              >
                <div
                  className="profile-souvenir-lightbox__content"
                  style={contentStyle}
                >
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
                      isReporting={isReporting}
                      isReported={isReported}
                      onLike={onLike}
                      onVisibilityChange={onVisibilityChange}
                      onRequestDelete={() =>
                        setIsDeleteConfirmationVisible(true)
                      }
                      onRequestReport={() => {
                        if (!canLike) {
                          window.electron.openAuthWindow(AuthPage.SignIn);
                          return;
                        }

                        setIsReportModalVisible(true);
                      }}
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

      <SouvenirReportModal
        visible={isReportModalVisible}
        isSubmitting={isReporting}
        onClose={() => setIsReportModalVisible(false)}
        onSubmit={(values) => onReport(souvenir, values)}
      />
    </>,
    document.body
  );
}
