import "./styles.scss";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  CaretLeftIcon,
  CaretRightIcon,
  EyeClosedIcon,
  EyeIcon,
  FlagIcon,
  GameControllerIcon,
  HeartIcon,
  ImageIcon,
  TrashIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type {
  ProfileSouvenir,
  ProfileSouvenirAchievement,
  SouvenirReportValues,
} from "@types";

import {
  Backdrop,
  Button,
  FocusItem,
  HorizontalFocusGroup,
  NavigationLayer,
  Tooltip,
  Typography,
  VerticalFocusGroup,
} from "../../../common";
import { FocusRegionContext } from "../../../context";
import { ConfirmationModal } from "../../../modals";
import { useGamepad, useNavigationScreenActions } from "../../../../hooks";
import { formatRelativeDate } from "../../../../helpers";
import {
  AuthPage,
  getPrimarySouvenirAchievement,
  getSouvenirVisualVariant,
} from "@shared";
import { NavigationService } from "../../../../services";
import { useInputModeStore } from "../../../../stores";
import { GamepadButtonType } from "../../../../types";
import { SouvenirReportModal } from "./report-modal";

export interface SouvenirLightboxProps {
  souvenir: ProfileSouvenir | null;
  items: ProfileSouvenir[];
  index: number;
  canLike: boolean;
  isOwner: boolean;
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

const navigation = NavigationService.getInstance();
const shouldRestoreSouvenirFocus = () =>
  useInputModeStore.getState().mode === "gamepad";

const getSouvenirRenderKey = (souvenir: ProfileSouvenir | null) =>
  souvenir?.id ?? "inactive";

const souvenirSlideVariants = {
  enter: (direction: number) =>
    direction === 0
      ? { opacity: 1, x: 0 }
      : { opacity: 1, x: `${direction * 100}%` },
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({
    opacity: 1,
    x: `${direction * -100}%`,
  }),
};

interface SouvenirLightboxFocusIds {
  rootRegion: string;
  summaryRegion: string;
  actionsRegion: string;
  otherAchievementsButton: string;
  likeButton: string;
  visibilityButton: string;
  deleteButton: string;
  reportButton: string;
}

const getSouvenirLightboxFocusIds = (
  souvenir: ProfileSouvenir | null
): SouvenirLightboxFocusIds => {
  const suffix = getSouvenirRenderKey(souvenir);

  return {
    rootRegion: `souvenir-lightbox:${suffix}`,
    summaryRegion: `souvenir-lightbox-summary:${suffix}`,
    actionsRegion: `souvenir-lightbox-actions:${suffix}`,
    otherAchievementsButton: `souvenir-lightbox-other-achievements:${suffix}`,
    likeButton: `souvenir-lightbox-like:${suffix}`,
    visibilityButton: `souvenir-lightbox-visibility:${suffix}`,
    deleteButton: `souvenir-lightbox-delete:${suffix}`,
    reportButton: `souvenir-lightbox-report:${suffix}`,
  };
};

const getLastActionFocusId = (
  focusIds: SouvenirLightboxFocusIds,
  isOwner: boolean,
  canFocusReport: boolean
) => {
  if (isOwner) return focusIds.deleteButton;
  if (canFocusReport) return focusIds.reportButton;

  return focusIds.likeButton;
};

interface SouvenirLightboxNavigationOptions {
  isOpen: boolean;
  isDeleteConfirmationVisible: boolean;
  isReportModalVisible: boolean;
  isContentWarningVisible: boolean;
  isOwner: boolean;
  canFocusReport: boolean;
  items: ProfileSouvenir[];
  index: number;
  focusIds: SouvenirLightboxFocusIds;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

function useSouvenirLightboxNavigation({
  isOpen,
  isDeleteConfirmationVisible,
  isReportModalVisible,
  isContentWarningVisible,
  isOwner,
  canFocusReport,
  items,
  index,
  focusIds,
  onClose,
  onNavigate,
}: SouvenirLightboxNavigationOptions) {
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const hasPrevious = index > 0;
  const hasNext = index < items.length - 1;
  const lastActionFocusId = getLastActionFocusId(
    focusIds,
    isOwner,
    canFocusReport
  );
  const navigateToIndex = useCallback(
    (nextIndex: number) => {
      if (!items[nextIndex]) return;
      onNavigate(nextIndex);
    },
    [items, onNavigate]
  );

  useNavigationScreenActions(
    isOpen &&
      !isDeleteConfirmationVisible &&
      !isReportModalVisible &&
      !isContentWarningVisible
      ? {
          press: { b: onClose },
          direction: {
            left: ({ currentFocusId }) => {
              if (currentFocusId === focusIds.likeButton && hasPrevious) {
                navigateToIndex(index - 1);
                return;
              }

              navigation.moveFocus("left");
            },
            right: ({ currentFocusId }) => {
              if (currentFocusId === lastActionFocusId && hasNext) {
                navigateToIndex(index + 1);
                return;
              }

              navigation.moveFocus("right");
            },
          },
        }
      : {}
  );

  useEffect(() => {
    const canNavigate =
      isOpen &&
      !isDeleteConfirmationVisible &&
      !isReportModalVisible &&
      !isContentWarningVisible;
    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (!canNavigate || !isActiveGamepadEvent(event) || !hasPrevious)
          return;

        navigateToIndex(index - 1);
      }
    );
    const removeRightBumper = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (!canNavigate || !isActiveGamepadEvent(event) || !hasNext) return;

        navigateToIndex(index + 1);
      }
    );

    return () => {
      removeLeftBumper();
      removeRightBumper();
    };
  }, [
    hasNext,
    hasPrevious,
    index,
    isActiveGamepadEvent,
    isContentWarningVisible,
    isDeleteConfirmationVisible,
    isOpen,
    isReportModalVisible,
    navigateToIndex,
    onButtonPressed,
  ]);

  return { hasPrevious, hasNext, navigateToIndex };
}

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

  const maxWidth = Math.min(Math.max(viewportSize.width - 144, 1), 1600);
  const reservedInfoHeight = getReservedInfoHeight();
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

const getReservedInfoHeight = () => 200;

function useViewportSize() {
  const [viewportSize, setViewportSize] = useState(() => ({
    width: globalThis.window.innerWidth,
    height: globalThis.window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => {
      setViewportSize({
        width: globalThis.window.innerWidth,
        height: globalThis.window.innerHeight,
      });
    };

    globalThis.window.addEventListener("resize", onResize);
    return () => globalThis.window.removeEventListener("resize", onResize);
  }, []);

  return viewportSize;
}

interface SouvenirLightboxMediaOptions {
  souvenir: ProfileSouvenir | null;
  items: ProfileSouvenir[];
  index: number;
  viewportSize: ViewportSize;
}

function useSouvenirLightboxMedia({
  souvenir,
  items,
  index,
  viewportSize,
}: SouvenirLightboxMediaOptions) {
  const [loadedImage, setLoadedImage] = useState<LoadedImage | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const loadedImagesRef = useRef(new Map<string, LoadedImage>());

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

  const prepareImage = useCallback((nextSouvenir: ProfileSouvenir) => {
    const imageUrl = nextSouvenir.imageUrl;
    setLoadedImage(
      imageUrl ? (loadedImagesRef.current.get(imageUrl) ?? null) : null
    );
  }, []);

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (!souvenir?.imageUrl || !naturalWidth || !naturalHeight) return;

      const nextLoadedImage = {
        imageUrl: souvenir.imageUrl,
        naturalWidth,
        naturalHeight,
      };

      loadedImagesRef.current.set(souvenir.imageUrl, nextLoadedImage);
      setLoadedImage(nextLoadedImage);
    },
    [souvenir]
  );

  const hasImage = Boolean(
    souvenir?.imageUrl && souvenir.imageUrl !== failedImageUrl
  );
  const showImagePlaceholder =
    !hasImage || loadedImage?.imageUrl !== souvenir?.imageUrl;
  const imageSize = getLightboxImageSize(
    loadedImage,
    souvenir?.imageUrl ?? null,
    viewportSize
  );

  return {
    hasImage,
    showImagePlaceholder,
    imageSize,
    prepareImage,
    handleImageLoad,
    markImageFailed: setFailedImageUrl,
  };
}

interface SouvenirSlideNavigationOptions {
  souvenir: ProfileSouvenir | null;
  items: ProfileSouvenir[];
  index: number;
  isContentWarningVisible: boolean;
  onNavigate: (index: number) => boolean;
  prepareImage: (souvenir: ProfileSouvenir) => void;
}

function useSouvenirSlideNavigation({
  souvenir,
  items,
  index,
  isContentWarningVisible,
  onNavigate,
  prepareImage,
}: SouvenirSlideNavigationOptions) {
  const [navigationDirection, setNavigationDirection] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const handleNavigate = useCallback(
    (nextIndex: number) => {
      if (isNavigating) return;

      const nextSouvenir = items[nextIndex];
      if (!nextSouvenir) return;

      if (!onNavigate(nextIndex)) return;

      prepareImage(nextSouvenir);
      setIsNavigating(true);
      setNavigationDirection(nextIndex > index ? 1 : -1);
    },
    [index, isNavigating, items, onNavigate, prepareImage]
  );

  useEffect(() => {
    if (souvenir) return;

    setNavigationDirection(0);
    setIsNavigating(false);
  }, [souvenir]);

  useEffect(() => {
    if (!isContentWarningVisible) return;

    setNavigationDirection(0);
    setIsNavigating(false);
  }, [isContentWarningVisible]);

  return {
    navigationDirection,
    isNavigating,
    handleNavigate,
    handleAnimationComplete: () => setIsNavigating(false),
  };
}

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
    ? "souvenir-lightbox__image-frame souvenir-lightbox__image-frame--placeholder"
    : "souvenir-lightbox__image-frame";

  return (
    <div className={imageFrameClassName} style={imageSize ?? undefined}>
      {showImagePlaceholder ? (
        <span className="souvenir-lightbox__image-placeholder">
          <ImageIcon size={64} />
        </span>
      ) : null}

      {hasImage ? (
        <img
          className="souvenir-lightbox__image"
          src={souvenir.imageUrl ?? undefined}
          alt={primaryAchievement.displayName}
          draggable={false}
          onLoad={onLoad}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

function SouvenirSummary({
  souvenir,
  focusIds,
}: Readonly<{
  souvenir: ProfileSouvenir;
  focusIds: SouvenirLightboxFocusIds;
}>) {
  const { t, i18n } = useTranslation("user_profile");
  const [failedGameIconUrl, setFailedGameIconUrl] = useState<string | null>(
    null
  );
  const [failedAchievementIconUrl, setFailedAchievementIconUrl] = useState<
    string | null
  >(null);
  const primaryAchievement = getPrimarySouvenirAchievement(souvenir);
  const additionalAchievements = souvenir.achievements.filter(
    (achievement) =>
      achievement.name.toUpperCase() !== primaryAchievement.name.toUpperCase()
  );
  const visualVariant = getSouvenirVisualVariant(primaryAchievement);
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const hasGameIcon = Boolean(
    souvenir.gameIconUrl && souvenir.gameIconUrl !== failedGameIconUrl
  );
  const hasAchievementIcon = Boolean(
    primaryAchievement.achievementIcon &&
      primaryAchievement.achievementIcon !== failedAchievementIconUrl
  );

  return (
    <div className="souvenir-lightbox__summary">
      <span className="souvenir-lightbox__icon">
        {hasAchievementIcon ? (
          <img
            className="souvenir-lightbox__icon-image"
            src={primaryAchievement.achievementIcon ?? undefined}
            alt=""
            draggable={false}
            onError={() =>
              setFailedAchievementIconUrl(primaryAchievement.achievementIcon)
            }
          />
        ) : (
          <TrophyIcon size={28} />
        )}
      </span>

      <div className="souvenir-lightbox__copy">
        <HorizontalFocusGroup
          regionId={focusIds.summaryRegion}
          className="souvenir-lightbox__title-row"
          asChild
        >
          <div>
            <Typography
              className="souvenir-lightbox__title"
              title={primaryAchievement.displayName}
            >
              {primaryAchievement.displayName}
            </Typography>

            {additionalAchievements.length > 0 ? (
              <Tooltip
                content={
                  <ul className="souvenir-lightbox__achievement-list">
                    {additionalAchievements.map((achievement) => (
                      <SouvenirAchievementListItem
                        key={achievement.name}
                        achievement={achievement}
                      />
                    ))}
                  </ul>
                }
                className="souvenir-lightbox__achievement-tooltip"
                position="top"
              >
                <FocusItem id={focusIds.otherAchievementsButton} asChild>
                  <button
                    type="button"
                    className="souvenir-lightbox__other-count"
                  >
                    {t("souvenir_other_achievements", {
                      count: additionalAchievements.length,
                    })}
                  </button>
                </FocusItem>
              </Tooltip>
            ) : null}

            {visualVariant ? (
              <span
                className={`souvenir-lightbox__rarity souvenir-lightbox__rarity--${visualVariant}`}
              >
                <TrophyIcon size={16} weight="fill" />
                {t(`${visualVariant}_souvenir`)}
              </span>
            ) : null}
          </div>
        </HorizontalFocusGroup>

        {primaryAchievement.description ? (
          <Typography
            className="souvenir-lightbox__description"
            title={primaryAchievement.description}
          >
            {primaryAchievement.description}
          </Typography>
        ) : null}

        <div className="souvenir-lightbox__meta">
          <span className="souvenir-lightbox__game">
            <span className="souvenir-lightbox__game-icon">
              {hasGameIcon ? (
                <img
                  src={souvenir.gameIconUrl ?? undefined}
                  alt=""
                  draggable={false}
                  onError={() => setFailedGameIconUrl(souvenir.gameIconUrl)}
                />
              ) : (
                <GameControllerIcon size={16} />
              )}
            </span>
            {souvenir.gameTitle ?? t("unknown_game")}
          </span>

          <span
            className="souvenir-lightbox__meta-separator"
            aria-hidden="true"
          />

          <span className="souvenir-lightbox__unlock-time">
            {t("souvenir_unlocked_on", {
              date: formatRelativeDate(primaryAchievement.unlockTime, {
                locale: language,
              }),
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
    <li className="souvenir-lightbox__achievement-list-item">
      <span className="souvenir-lightbox__achievement-list-icon">
        {hasIcon ? (
          <img
            src={achievement.achievementIcon ?? undefined}
            alt=""
            draggable={false}
            onError={() => setFailedIconUrl(achievement.achievementIcon)}
          />
        ) : (
          <TrophyIcon size={16} />
        )}
      </span>
      <span className="souvenir-lightbox__achievement-list-copy">
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
  focusIds: SouvenirLightboxFocusIds;
  canLike: boolean;
  isOwner: boolean;
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
  focusIds,
  canLike,
  isOwner,
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
  const isPrivate = souvenir.visibility === "PRIVATE";
  const visibilityTitleKey = isPrivate
    ? "show_souvenir_on_profile"
    : "hide_souvenir_from_profile";
  const visibilityLabelKey = isPrivate ? "show_souvenir" : "hide_souvenir";
  const VisibilityIcon = isPrivate ? EyeClosedIcon : EyeIcon;

  return (
    <HorizontalFocusGroup
      regionId={focusIds.actionsRegion}
      className="souvenir-lightbox__actions"
    >
      <Button
        variant="secondary"
        size="small"
        focusId={focusIds.likeButton}
        disabled={!canLike}
        loading={isLiking}
        className={isLiking ? "souvenir-lightbox__action--pending" : undefined}
        icon={
          <HeartIcon
            size={20}
            weight={souvenir.likedByMe ? "fill" : "regular"}
          />
        }
        onClick={() => onLike(souvenir)}
      >
        {String(souvenir.likeCount)}
      </Button>

      {isOwner ? (
        <>
          <Button
            variant="secondary"
            size="small"
            focusId={focusIds.visibilityButton}
            loading={isUpdatingVisibility}
            icon={<VisibilityIcon size={20} />}
            onClick={() => onVisibilityChange(souvenir)}
            aria-label={t(visibilityTitleKey)}
            title={t(visibilityTitleKey)}
          >
            {t(visibilityLabelKey)}
          </Button>

          <Button
            variant="danger"
            size="icon"
            focusId={focusIds.deleteButton}
            disabled={isDeleting}
            icon={<TrashIcon size={20} />}
            onClick={onRequestDelete}
            aria-label={t("delete_souvenir")}
            title={t("delete_souvenir")}
          >
            {null}
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          size="small"
          focusId={focusIds.reportButton}
          disabled={isReporting || isReported}
          loading={isReporting}
          icon={<FlagIcon size={20} />}
          onClick={onRequestReport}
          aria-label={t(isReported ? "souvenir_reported" : "report_souvenir")}
          title={t(isReported ? "souvenir_reported" : "report_souvenir")}
        >
          {t(isReported ? "reported" : "report")}
        </Button>
      )}
    </HorizontalFocusGroup>
  );
}

export function SouvenirLightbox({
  souvenir,
  items,
  index,
  canLike,
  isOwner,
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
  const { t } = useTranslation(["user_profile", "game_details", "modal"]);
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const viewportSize = useViewportSize();
  const focusIds = getSouvenirLightboxFocusIds(souvenir);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const {
    hasImage,
    showImagePlaceholder,
    imageSize,
    prepareImage,
    handleImageLoad,
    markImageFailed,
  } = useSouvenirLightboxMedia({ souvenir, items, index, viewportSize });
  const {
    navigationDirection,
    isNavigating,
    handleNavigate,
    handleAnimationComplete,
  } = useSouvenirSlideNavigation({
    souvenir,
    items,
    index,
    isContentWarningVisible,
    onNavigate,
    prepareImage,
  });
  const { hasPrevious, hasNext, navigateToIndex } =
    useSouvenirLightboxNavigation({
      isOpen: Boolean(souvenir),
      isDeleteConfirmationVisible,
      isReportModalVisible,
      isContentWarningVisible,
      isOwner,
      canFocusReport: !isReported,
      items,
      index,
      focusIds,
      onClose,
      onNavigate: handleNavigate,
    });
  const lastActionFocusId = getLastActionFocusId(
    focusIds,
    isOwner,
    !isReported
  );
  const initialActionFocusId =
    navigationDirection > 0 ? lastActionFocusId : focusIds.likeButton;
  const primaryAchievement = souvenir
    ? getPrimarySouvenirAchievement(souvenir)
    : null;
  const lightboxStyle = {
    "--souvenir-info-height": `${getReservedInfoHeight()}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!souvenir) {
      setIsDeleteConfirmationVisible(false);
      setIsReportModalVisible(false);
    }
  }, [souvenir]);

  useEffect(() => {
    if (
      !souvenir ||
      isDeleteConfirmationVisible ||
      isReportModalVisible ||
      isContentWarningVisible
    )
      return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    isContentWarningVisible,
    isDeleteConfirmationVisible,
    isReportModalVisible,
    onClose,
    souvenir,
  ]);

  const handleDeleteConfirm = async () => {
    if (!souvenir) return;

    const wasDeleted = await onDelete(souvenir);
    if (!wasDeleted) return;

    setIsDeleteConfirmationVisible(false);
    onClose();
  };

  const portalTarget =
    document.getElementById("big-picture") ??
    document.getElementById("root") ??
    document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      {souvenir ? (
        <Backdrop className="souvenir-lightbox__backdrop">
          <div
            className="souvenir-lightbox__overlay"
            onPointerDown={(event) => {
              if (
                event.target === event.currentTarget &&
                !isDeleteConfirmationVisible &&
                !isReportModalVisible &&
                !isContentWarningVisible &&
                !isNavigating
              ) {
                onClose();
              }
            }}
          >
            {hasPrevious ? (
              <button
                type="button"
                className="souvenir-lightbox__nav-button souvenir-lightbox__nav-button--left"
                onClick={() => navigateToIndex(index - 1)}
                disabled={isNavigating || isContentWarningVisible}
                aria-label={t("previous_media", { ns: "game_details" })}
              >
                <CaretLeftIcon size={32} />
              </button>
            ) : null}

            {hasNext ? (
              <button
                type="button"
                className="souvenir-lightbox__nav-button souvenir-lightbox__nav-button--right"
                onClick={() => navigateToIndex(index + 1)}
                disabled={isNavigating || isContentWarningVisible}
                aria-label={t("next_media", { ns: "game_details" })}
              >
                <CaretRightIcon size={32} />
              </button>
            ) : null}

            <NavigationLayer
              rootRegionId={focusIds.rootRegion}
              initialFocusId={initialActionFocusId}
              restoreFocusOnUnmount={shouldRestoreSouvenirFocus}
            >
              <div
                ref={stageRef}
                className={
                  isNavigating
                    ? "souvenir-lightbox__stage souvenir-lightbox__stage--navigating"
                    : "souvenir-lightbox__stage"
                }
              >
                <AnimatePresence initial={false} custom={navigationDirection}>
                  <motion.div
                    key={getSouvenirRenderKey(souvenir)}
                    className="souvenir-lightbox__slide"
                    custom={navigationDirection}
                    variants={souvenirSlideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      duration: 0.42,
                      ease: [0.4, 0, 0.2, 1],
                    }}
                    onAnimationComplete={handleAnimationComplete}
                  >
                    <dialog
                      open
                      className="souvenir-lightbox"
                      style={lightboxStyle}
                      data-souvenir-lightbox-key={getSouvenirRenderKey(
                        souvenir
                      )}
                      aria-modal="true"
                      aria-label={primaryAchievement?.displayName}
                    >
                      <SouvenirImage
                        souvenir={souvenir}
                        hasImage={hasImage}
                        showImagePlaceholder={showImagePlaceholder}
                        imageSize={imageSize}
                        onLoad={handleImageLoad}
                        onError={() => markImageFailed(souvenir.imageUrl)}
                      />

                      <VerticalFocusGroup
                        regionId={focusIds.rootRegion}
                        className="souvenir-lightbox__info"
                        asChild
                      >
                        <section>
                          <SouvenirSummary
                            souvenir={souvenir}
                            focusIds={focusIds}
                          />
                          <SouvenirActions
                            souvenir={souvenir}
                            focusIds={focusIds}
                            canLike={canLike}
                            isOwner={isOwner}
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
                                void globalThis.window.electron.openAuthWindow(
                                  AuthPage.SignIn
                                );
                                return;
                              }

                              setIsReportModalVisible(true);
                            }}
                          />
                        </section>
                      </VerticalFocusGroup>
                    </dialog>
                  </motion.div>
                </AnimatePresence>
              </div>
            </NavigationLayer>

            <ConfirmationModal
              visible={isDeleteConfirmationVisible}
              backdropClassName="souvenir-lightbox__confirmation-backdrop"
              title={t("delete_souvenir_modal_title")}
              description={t("delete_souvenir_modal_description")}
              confirmLabel={t("delete_souvenir_modal_delete_button")}
              danger
              loading={isDeleting}
              onClose={() => setIsDeleteConfirmationVisible(false)}
              onConfirm={handleDeleteConfirm}
            />

            <SouvenirReportModal
              visible={isReportModalVisible}
              isSubmitting={isReporting}
              onClose={() => setIsReportModalVisible(false)}
              onSubmit={(values) => onReport(souvenir, values)}
            />
          </div>
        </Backdrop>
      ) : null}
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
