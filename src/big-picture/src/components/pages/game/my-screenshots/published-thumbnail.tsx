import { ChatCircleIcon, HeartIcon, ImageIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot } from "@types";
import { useScreenshotImageFallback } from "@shared";

import { FocusItem } from "../../../common";
import type { FocusOverrides } from "../../../../services";
import {
  ProgressiveScreenshotImage,
  ScreenshotBlurLabel,
  getScreenshotAltText,
  getScreenshotBlurReason,
  shouldBlurScreenshot,
  useRevealedScreenshotSpoilers,
  useSensitiveScreenshotGate,
} from "../../screenshots";

interface PublishedScreenshotThumbnailProps {
  screenshot: ProfileScreenshot;
  focusId: string;
  showCommentCount: boolean;
  navigationOverrides: FocusOverrides;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onRefreshImage: (screenshot: ProfileScreenshot) => Promise<void>;
}

export function PublishedScreenshotThumbnail({
  screenshot,
  focusId,
  showCommentCount,
  navigationOverrides,
  onOpen,
  onRefreshImage,
}: Readonly<PublishedScreenshotThumbnailProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const revealedIds = useRevealedScreenshotSpoilers(
    (state) => state.revealedIds
  );
  const imageUrl = screenshot.thumbnailUrl ?? screenshot.imageUrl;
  const refreshImage = useCallback(
    () => onRefreshImage(screenshot),
    [onRefreshImage, screenshot]
  );
  const { hasImage, handleImageError } = useScreenshotImageFallback(
    imageUrl,
    refreshImage
  );
  const sensitiveGate = useSensitiveScreenshotGate();
  const blurReason = getScreenshotBlurReason(
    sensitiveGate.isHidden(screenshot),
    shouldBlurScreenshot(screenshot, revealedIds)
  );
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";

  return (
    <>
      <FocusItem id={focusId} navigationOverrides={navigationOverrides} asChild>
        <button
          type="button"
          className="game-my-screenshots__thumbnail"
          aria-label={getScreenshotAltText(screenshot, t, language)}
          onClick={() =>
            sensitiveGate.guard(screenshot, () => onOpen(screenshot))
          }
        >
          {hasImage && imageUrl ? (
            <ProgressiveScreenshotImage
              className={cn("game-my-screenshots__image", {
                "game-my-screenshots__image--spoiler": blurReason !== null,
              })}
              sources={[imageUrl]}
              thumbHash={screenshot.thumbHash}
              alt=""
              loading="lazy"
              onError={() => void handleImageError()}
            />
          ) : (
            <span className="game-my-screenshots__placeholder">
              <ImageIcon size={24} />
            </span>
          )}

          <span className="game-my-screenshots__stats">
            <span
              className="game-my-screenshots__stat"
              aria-label={t("screenshots_like_count", {
                count: screenshot.likeCount,
              })}
            >
              <HeartIcon
                size={12}
                weight={screenshot.likedByMe ? "fill" : "bold"}
              />
              {screenshot.likeCount}
            </span>
            {showCommentCount ? (
              <span
                className="game-my-screenshots__stat"
                aria-label={t("screenshots_comment_count", {
                  count: screenshot.commentCount,
                })}
              >
                <ChatCircleIcon size={12} weight="bold" />
                {screenshot.commentCount}
              </span>
            ) : null}
          </span>

          {blurReason ? (
            <ScreenshotBlurLabel
              className="game-my-screenshots__spoiler"
              reason={blurReason}
              iconSize={16}
            />
          ) : null}
        </button>
      </FocusItem>
      {sensitiveGate.modal}
    </>
  );
}
