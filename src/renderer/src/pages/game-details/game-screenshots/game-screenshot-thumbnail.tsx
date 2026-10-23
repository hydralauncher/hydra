import { useTranslation } from "react-i18next";
import { EyeClosedIcon, ImageIcon } from "@primer/octicons-react";
import cn from "classnames";

import {
  ScreenshotOwnerBadge,
  ScreenshotStats,
  getScreenshotGameTitle,
  useScreenshotSpoiler,
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
  const imageUrl = screenshot.thumbnailUrl ?? screenshot.imageUrl;
  const { hasImage, handleImageError } = useScreenshotImageFallback(
    imageUrl,
    () => onImageError(screenshot)
  );
  const altText = t("screenshot_alt", {
    game: getScreenshotGameTitle(screenshot, t),
    date: formatDate(screenshot.capturedAt),
  });

  const handleClick = () => {
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
          "game-screenshots-box__thumbnail--spoiler": isSpoilerHidden,
        })}
        onClick={handleClick}
        aria-label={isSpoilerHidden ? t("spoiler_reveal") : altText}
        title={isSpoilerHidden ? t("spoiler_reveal") : t("open_screenshot")}
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

        {isSpoilerHidden ? (
          <span className="game-screenshots-box__thumbnail-spoiler">
            <EyeClosedIcon size={16} />
            <span>{t("spoiler")}</span>
          </span>
        ) : null}
      </button>

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
