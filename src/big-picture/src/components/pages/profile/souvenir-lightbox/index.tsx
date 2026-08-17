import "./styles.scss";

import { useEffect, useState, type SyntheticEvent } from "react";
import { AnimatePresence } from "framer-motion";
import {
  EyeClosedIcon,
  EyeIcon,
  GameControllerIcon,
  HeartIcon,
  ImageIcon,
  TrashIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { ProfileAchievement } from "@types";

import {
  Backdrop,
  Button,
  HorizontalFocusGroup,
  Typography,
} from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { useNavigationScreenActions } from "../../../../hooks";
import { formatRelativeDate } from "../../../../helpers";
import { getSouvenirVisualVariant } from "@shared";

export interface SouvenirLightboxProps {
  souvenir: ProfileAchievement | null;
  canLike: boolean;
  isOwner: boolean;
  isLiking: boolean;
  isUpdatingVisibility: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onLike: (souvenir: ProfileAchievement) => void;
  onVisibilityChange: (souvenir: ProfileAchievement) => void;
  onDelete: (souvenir: ProfileAchievement) => Promise<boolean>;
}

const SOUVENIR_LIGHTBOX_ACTIONS_REGION_ID = "souvenir-lightbox-actions";
const SOUVENIR_LIGHTBOX_LIKE_BUTTON_ID = "souvenir-lightbox-like";

const hideBrokenImage = (event: SyntheticEvent<HTMLImageElement>) => {
  event.currentTarget.style.opacity = "0";
};

export function SouvenirLightbox({
  souvenir,
  canLike,
  isOwner,
  isLiking,
  isUpdatingVisibility,
  isDeleting,
  onClose,
  onLike,
  onVisibilityChange,
  onDelete,
}: Readonly<SouvenirLightboxProps>) {
  const { t, i18n } = useTranslation("user_profile");
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] =
    useState(false);
  const [loadedImage, setLoadedImage] = useState<{
    imageUrl: string;
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: globalThis.window.innerWidth,
    height: globalThis.window.innerHeight,
  }));
  useNavigationScreenActions(
    souvenir && !isDeleteConfirmationVisible ? { press: { b: onClose } } : {}
  );

  useEffect(() => {
    if (!souvenir) setIsDeleteConfirmationVisible(false);
  }, [souvenir]);

  useEffect(() => {
    if (!souvenir || isDeleteConfirmationVisible) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.window.removeEventListener("keydown", onKeyDown);
    };
  }, [isDeleteConfirmationVisible, onClose, souvenir]);

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

  const visualVariant = souvenir ? getSouvenirVisualVariant(souvenir) : null;
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const hasImage = Boolean(
    souvenir?.imageUrl && souvenir.imageUrl !== failedImageUrl
  );
  const showImagePlaceholder =
    !hasImage || loadedImage?.imageUrl !== souvenir?.imageUrl;
  const naturalImageWidth = loadedImage?.naturalWidth ?? 1;
  const naturalImageHeight = loadedImage?.naturalHeight ?? 1;
  const imageSize =
    loadedImage?.imageUrl === souvenir?.imageUrl
      ? (() => {
          const maxWidth = Math.min(viewportSize.width * 0.9, 1600);
          const maxHeight = Math.max(viewportSize.height * 0.9 - 152, 1);
          const scale = Math.min(
            maxWidth / naturalImageWidth,
            maxHeight / naturalImageHeight
          );

          return {
            width: naturalImageWidth * scale,
            height: naturalImageHeight * scale,
          };
        })()
      : null;

  return (
    <AnimatePresence>
      {souvenir ? (
        <Backdrop>
          <div className="souvenir-lightbox">
            <div
              className={`souvenir-lightbox__image-frame ${showImagePlaceholder ? "souvenir-lightbox__image-frame--placeholder" : ""}`}
              style={imageSize ?? undefined}
            >
              <span className="souvenir-lightbox__image-placeholder">
                <ImageIcon size={64} />
              </span>

              {hasImage ? (
                <img
                  className="souvenir-lightbox__image"
                  src={souvenir.imageUrl ?? undefined}
                  alt={souvenir.displayName}
                  draggable={false}
                  onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;

                    if (souvenir.imageUrl && naturalWidth && naturalHeight) {
                      setLoadedImage({
                        imageUrl: souvenir.imageUrl,
                        naturalWidth,
                        naturalHeight,
                      });
                    }
                  }}
                  onError={() => setFailedImageUrl(souvenir.imageUrl)}
                />
              ) : null}
            </div>

            <section className="souvenir-lightbox__info">
              <div className="souvenir-lightbox__summary">
                <span className="souvenir-lightbox__icon">
                  <TrophyIcon size={28} />
                  {souvenir.achievementIcon ? (
                    <img
                      className="souvenir-lightbox__icon-image"
                      src={souvenir.achievementIcon}
                      alt=""
                      draggable={false}
                      onError={hideBrokenImage}
                    />
                  ) : null}
                </span>

                <div className="souvenir-lightbox__copy">
                  <div className="souvenir-lightbox__title-row">
                    <Typography className="souvenir-lightbox__title">
                      {souvenir.displayName}
                    </Typography>

                    {visualVariant ? (
                      <span
                        className={`souvenir-lightbox__rarity souvenir-lightbox__rarity--${visualVariant}`}
                      >
                        <TrophyIcon size={16} weight="fill" />
                        {t(`${visualVariant}_souvenir`)}
                      </span>
                    ) : null}
                  </div>

                  {souvenir.description ? (
                    <Typography className="souvenir-lightbox__description">
                      {souvenir.description}
                    </Typography>
                  ) : null}

                  <div className="souvenir-lightbox__meta">
                    <span className="souvenir-lightbox__game">
                      <span className="souvenir-lightbox__game-icon">
                        <GameControllerIcon size={16} />
                        {souvenir.gameIconUrl ? (
                          <img
                            src={souvenir.gameIconUrl}
                            alt=""
                            draggable={false}
                            onError={hideBrokenImage}
                          />
                        ) : null}
                      </span>
                      {souvenir.gameTitle ?? t("unknown_game")}
                    </span>

                    <span
                      className="souvenir-lightbox__meta-separator"
                      aria-hidden="true"
                    />

                    <span className="souvenir-lightbox__unlock-time">
                      {t("souvenir_unlocked_on", {
                        date: formatRelativeDate(souvenir.unlockTime, {
                          locale: language,
                        }),
                      })}
                    </span>
                  </div>
                </div>
              </div>

              <HorizontalFocusGroup
                regionId={SOUVENIR_LIGHTBOX_ACTIONS_REGION_ID}
                className="souvenir-lightbox__actions"
              >
                <Button
                  variant="tertiary"
                  size="small"
                  focusId={SOUVENIR_LIGHTBOX_LIKE_BUTTON_ID}
                  stealFocusOnAppear
                  disabled={!canLike || isLiking}
                  className={
                    isLiking ? "souvenir-lightbox__action--pending" : undefined
                  }
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
                      variant="tertiary"
                      size="small"
                      loading={isUpdatingVisibility}
                      icon={
                        souvenir.visibility === "PRIVATE" ? (
                          <EyeClosedIcon size={20} />
                        ) : (
                          <EyeIcon size={20} />
                        )
                      }
                      onClick={() => onVisibilityChange(souvenir)}
                      aria-label={t(
                        souvenir.visibility === "PRIVATE"
                          ? "show_souvenir_on_profile"
                          : "hide_souvenir_from_profile"
                      )}
                      title={t(
                        souvenir.visibility === "PRIVATE"
                          ? "show_souvenir_on_profile"
                          : "hide_souvenir_from_profile"
                      )}
                    >
                      {t(
                        souvenir.visibility === "PRIVATE"
                          ? "show_souvenir"
                          : "hide_souvenir"
                      )}
                    </Button>

                    <Button
                      variant="danger"
                      size="icon"
                      disabled={isDeleting}
                      icon={<TrashIcon size={20} />}
                      onClick={() => setIsDeleteConfirmationVisible(true)}
                      aria-label={t("delete_souvenir")}
                      title={t("delete_souvenir")}
                    >
                      {null}
                    </Button>
                  </>
                ) : null}
              </HorizontalFocusGroup>
            </section>
          </div>

          <ConfirmationModal
            visible={isDeleteConfirmationVisible}
            title={t("delete_souvenir_modal_title")}
            description={t("delete_souvenir_modal_description")}
            confirmLabel={t("delete_souvenir_modal_delete_button")}
            danger
            loading={isDeleting}
            onClose={() => setIsDeleteConfirmationVisible(false)}
            onConfirm={async () => {
              const wasDeleted = await onDelete(souvenir);
              if (wasDeleted) {
                setIsDeleteConfirmationVisible(false);
                onClose();
              }
            }}
          />
        </Backdrop>
      ) : null}
    </AnimatePresence>
  );
}
