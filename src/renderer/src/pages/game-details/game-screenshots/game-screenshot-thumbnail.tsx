import { useTranslation } from "react-i18next";
import { EyeClosedIcon, ImageIcon, ShieldIcon } from "@primer/octicons-react";
import cn from "classnames";

import {
  ScreenshotOwnerBadge,
  ScreenshotStats,
  SensitiveScreenshotModal,
  getScreenshotGameTitle,
  useScreenshotSpoiler,
  useSensitiveScreenshotConfirmation,
} from "@renderer/components/screenshots";
import { useDate } from "@renderer/hooks";
import { useScreenshotImageFallback } from "@shared";
import type { ProfileScreenshot } from "@types";

interface GameScreenshotThumbnailProps {
  screenshot: ProfileScreenshot;
  isLiking: boolean;
  showCommentCount: boolean;
  showOwner?: boolean;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onLike: (screenshot: ProfileScreenshot) => void;
  onImageError: (screenshot: ProfileScreenshot) => Promise<void>;
}

export function GameScreenshotThumbnail({
  screenshot,
  isLiking,
  showCommentCount,
  showOwner = true,
  onOpen,
  onLike,
  onImageError,
}: Readonly<GameScreenshotThumbnailProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDate } = useDate();
  const { isHidden: isSpoilerHidden, reveal } =
    useScreenshotSpoiler(screenshot);
  const sensitive = useSensitiveScreenshotConfirmation(screenshot);
  const imageUrl = screenshot.thumbnailUrl ?? screenshot.imageUrl;
  const { hasImage, handleImageError } = useScreenshotImageFallback(
    imageUrl,
    () => onImageError(screenshot)
  );
  const altText = t("screenshot_alt", {
    game: getScreenshotGameTitle(screenshot, t),
    date: formatDate(screenshot.capturedAt),
  });

  const isBlurred = sensitive.isHidden || isSpoilerHidden;
  const hiddenLabel = sensitive.isHidden
    ? t("sensitive_content")
    : t("spoiler_reveal");

  const openUnlessSpoiler = () => {
    if (!isSpoilerHidden) onOpen(screenshot);
  };

  const handleClick = () => {
    if (sensitive.isHidden) {
      sensitive.requestReveal(openUnlessSpoiler);
      return;
    }

    if (isSpoilerHidden) {
      reveal();
      return;
    }

    onOpen(screenshot);
  };

  return (
    <div className="game-screenshots-box__item">
      <button
        type="button"
        className={cn("game-screenshots-box__thumbnail", {
          "game-screenshots-box__thumbnail--spoiler": isBlurred,
        })}
        onClick={handleClick}
        aria-label={isBlurred ? hiddenLabel : altText}
        title={isBlurred ? hiddenLabel : t("open_screenshot")}
      >
        {hasImage ? (
          <img
            className="game-screenshots-box__thumbnail-image"
            src={imageUrl ?? undefined}
            alt={altText}
            loading="lazy"
            onError={() => void handleImageError()}
          />
        ) : (
          <span className="game-screenshots-box__thumbnail-placeholder">
            <ImageIcon size={20} />
          </span>
        )}

        {sensitive.isHidden ? (
          <span className="game-screenshots-box__thumbnail-spoiler">
            <ShieldIcon size={16} />
            <span>{t("sensitive")}</span>
          </span>
        ) : null}
        {!sensitive.isHidden && isSpoilerHidden ? (
          <span className="game-screenshots-box__thumbnail-spoiler">
            <EyeClosedIcon size={16} />
            <span>{t("spoiler")}</span>
          </span>
        ) : null}
      </button>

      <SensitiveScreenshotModal {...sensitive.modalProps} />

      {showOwner ? (
        <ScreenshotOwnerBadge
          owner={screenshot.owner}
          className="game-screenshots-box__owner"
        />
      ) : null}

      <ScreenshotStats
        screenshot={screenshot}
        isLikeDisabled={isLiking}
        showCommentCount={showCommentCount}
        className="game-screenshots-box__stats"
        onLike={onLike}
      />
    </div>
  );
}
