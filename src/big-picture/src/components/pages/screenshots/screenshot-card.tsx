import "./screenshot-card.scss";

import {
  ChatCircleIcon,
  EyeClosedIcon,
  EyeSlashIcon,
  GameControllerIcon,
  HeartIcon,
  ImageIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot } from "@types";
import { useScreenshotImageFallback } from "@shared";

import { FocusItem, UserProfileAvatar } from "../../common";
import type { FocusOverrides } from "../../../services";
import { Feature, useFeature } from "../../../hooks";
import {
  getScreenshotAltText,
  getScreenshotGameTitle,
  shouldBlurScreenshot,
} from "./helpers";
import { useRevealedScreenshotSpoilers } from "./use-revealed-spoilers";

export interface ScreenshotCardProps {
  screenshot: ProfileScreenshot;
  focusId: string;
  showOwnerDetails: boolean;
  showAuthor: boolean;
  navigationOverrides?: FocusOverrides;
  className?: string;
  onActivate: (screenshot: ProfileScreenshot) => void;
  onRefreshImage?: (screenshot: ProfileScreenshot) => Promise<void>;
}

function ScreenshotCardBadges({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const { t } = useTranslation("big_picture");

  return (
    <div className="screenshot-card__badges">
      {screenshot.visibility === "FRIENDS" ? (
        <span
          className="screenshot-card__badge screenshot-card__badge--icon"
          title={t("screenshots_visibility_friends")}
          aria-label={t("screenshots_visibility_friends")}
        >
          <UsersIcon size={14} weight="bold" />
        </span>
      ) : null}

      {screenshot.visibility === "PRIVATE" ? (
        <span
          className="screenshot-card__badge screenshot-card__badge--icon"
          title={t("screenshots_visibility_private")}
          aria-label={t("screenshots_visibility_private")}
        >
          <EyeClosedIcon size={14} weight="bold" />
        </span>
      ) : null}
    </div>
  );
}

function ScreenshotCardMeta({
  screenshot,
  showAuthor,
}: Readonly<{ screenshot: ProfileScreenshot; showAuthor: boolean }>) {
  const { t } = useTranslation("big_picture");
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const hasGameIcon = Boolean(
    screenshot.gameIconUrl && screenshot.gameIconUrl !== failedIconUrl
  );

  if (showAuthor) {
    return (
      <div className="screenshot-card__meta">
        <UserProfileAvatar
          image={screenshot.owner.profileImageUrl}
          alt=""
          className="screenshot-card__author-avatar"
          fallbackClassName="screenshot-card__author-avatar--fallback"
          width={20}
          height={20}
          iconSize={12}
        />
        <span className="screenshot-card__meta-text">
          {screenshot.owner.displayName}
        </span>
      </div>
    );
  }

  return (
    <div className="screenshot-card__meta">
      <span className="screenshot-card__game-icon">
        {hasGameIcon ? (
          <img
            src={screenshot.gameIconUrl ?? undefined}
            alt=""
            draggable={false}
            onError={() => setFailedIconUrl(screenshot.gameIconUrl)}
          />
        ) : (
          <GameControllerIcon size={12} />
        )}
      </span>
      <span className="screenshot-card__meta-text">
        {getScreenshotGameTitle(screenshot, t)}
      </span>
    </div>
  );
}

export function ScreenshotCard({
  screenshot,
  focusId,
  showOwnerDetails,
  showAuthor,
  navigationOverrides,
  className,
  onActivate,
  onRefreshImage,
}: Readonly<ScreenshotCardProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const { isFeatureEnabled } = useFeature();
  const revealedIds = useRevealedScreenshotSpoilers(
    (state) => state.revealedIds
  );
  const imageUrl = screenshot.thumbnailUrl ?? screenshot.imageUrl;
  const refreshImage = useMemo(
    () => (onRefreshImage ? () => onRefreshImage(screenshot) : undefined),
    [onRefreshImage, screenshot]
  );
  const { hasImage, handleImageError } = useScreenshotImageFallback(
    imageUrl,
    refreshImage
  );
  const isBlurred = shouldBlurScreenshot(screenshot, revealedIds);
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const altText = getScreenshotAltText(screenshot, t, language);

  return (
    <FocusItem
      id={focusId}
      actions={{ primary: () => onActivate(screenshot) }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <li className={cn("screenshot-card", className)}>
        <button
          type="button"
          className="screenshot-card__open-button"
          aria-label={altText}
          tabIndex={-1}
          onClick={() => onActivate(screenshot)}
        />

        <div className="screenshot-card__frame">
          {hasImage ? (
            <img
              className={cn("screenshot-card__image", {
                "screenshot-card__image--spoiler": isBlurred,
              })}
              src={imageUrl ?? undefined}
              alt={altText}
              draggable={false}
              loading="lazy"
              onError={() => void handleImageError()}
            />
          ) : (
            <span className="screenshot-card__placeholder">
              <ImageIcon size={36} />
            </span>
          )}

          {isBlurred ? (
            <span className="screenshot-card__spoiler">
              <EyeSlashIcon size={18} weight="bold" />
              {t("screenshots_spoiler")}
            </span>
          ) : null}

          {showOwnerDetails ? (
            <ScreenshotCardBadges screenshot={screenshot} />
          ) : null}

          <div className="screenshot-card__stats">
            <span className="screenshot-card__stat">
              <HeartIcon
                size={14}
                weight={screenshot.likedByMe ? "fill" : "bold"}
              />
              {screenshot.likeCount}
            </span>
            {isFeatureEnabled(Feature.ScreenshotComments) ? (
              <span className="screenshot-card__stat">
                <ChatCircleIcon size={14} weight="bold" />
                {screenshot.commentCount}
              </span>
            ) : null}
          </div>
        </div>

        <ScreenshotCardMeta screenshot={screenshot} showAuthor={showAuthor} />
      </li>
    </FocusItem>
  );
}
