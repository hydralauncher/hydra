import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EyeClosedIcon,
  ImageIcon,
  LockIcon,
  PeopleIcon,
  SearchIcon,
  ShieldIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Avatar } from "../avatar/avatar";
import { Link } from "../link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate } from "@renderer/hooks";
import { useScreenshotImageFallback } from "@shared";
import type { ProfileScreenshot } from "@types";

import {
  getScreenshotGameTitle,
  isScreenshotApproved,
} from "./screenshot-labels";
import { ProgressiveScreenshotImage } from "./progressive-screenshot-image";
import { ScreenshotStats } from "./screenshot-stats";
import { SensitiveScreenshotModal } from "./sensitive-screenshot-modal";
import { useScreenshotSpoiler } from "./use-screenshot-spoiler";
import { useSensitiveScreenshotConfirmation } from "./use-sensitive-screenshot";

import "./screenshot-card.scss";

export type ScreenshotCardVariant = "profile" | "game" | "tile";

interface ScreenshotCardProps {
  screenshot: ProfileScreenshot;
  variant: ScreenshotCardVariant;
  isOwner: boolean;
  isLiking: boolean;
  showCommentCount: boolean;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onLike: (screenshot: ProfileScreenshot) => void;
  onImageError: (screenshot: ProfileScreenshot) => Promise<void>;
}

function ScreenshotGameLabel({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const { t } = useTranslation("screenshots");
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const title = getScreenshotGameTitle(screenshot, t);
  const hasIcon = Boolean(
    screenshot.gameIconUrl && screenshot.gameIconUrl !== failedIconUrl
  );
  const icon = (
    <span className="screenshot-card__game-icon">
      {hasIcon ? (
        <img
          src={screenshot.gameIconUrl ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setFailedIconUrl(screenshot.gameIconUrl)}
        />
      ) : (
        <ImageIcon size={12} />
      )}
    </span>
  );

  if (screenshot.isCustomGame || !screenshot.objectId) {
    return (
      <span className="screenshot-card__game" title={title}>
        {icon}
        <span className="screenshot-card__game-name">{title}</span>
      </span>
    );
  }

  return (
    <Link
      className="screenshot-card__game screenshot-card__game--link"
      to={buildGameDetailsPath({
        shop: screenshot.shop,
        objectId: screenshot.objectId,
        title,
      })}
    >
      {icon}
      <span className="screenshot-card__game-name" title={title}>
        {title}
      </span>
    </Link>
  );
}

function ScreenshotOwnerBadges({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const { t } = useTranslation("screenshots");

  return (
    <div className="screenshot-card__badges">
      {screenshot.visibility === "PRIVATE" ? (
        <span
          className="screenshot-card__badge screenshot-card__badge--icon"
          title={t("visibility_private")}
          aria-label={t("visibility_private")}
        >
          <LockIcon size={12} />
        </span>
      ) : null}
      {screenshot.visibility === "FRIENDS" ? (
        <span
          className="screenshot-card__badge screenshot-card__badge--icon"
          title={t("visibility_friends")}
          aria-label={t("visibility_friends")}
        >
          <PeopleIcon size={12} />
        </span>
      ) : null}
    </div>
  );
}

interface ScreenshotCardMediaProps {
  screenshot: ProfileScreenshot;
  altText: string;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onImageError: (screenshot: ProfileScreenshot) => Promise<void>;
}

function ScreenshotCardMedia({
  screenshot,
  altText,
  onOpen,
  onImageError,
}: Readonly<ScreenshotCardMediaProps>) {
  const { t } = useTranslation("screenshots");
  const { isHidden: isSpoilerHidden, reveal } =
    useScreenshotSpoiler(screenshot);
  const sensitive = useSensitiveScreenshotConfirmation(screenshot);
  const imageUrl = screenshot.thumbnailUrl ?? screenshot.imageUrl;
  const { hasImage, handleImageError } = useScreenshotImageFallback(
    imageUrl,
    () => onImageError(screenshot)
  );
  const isBlurred = sensitive.isHidden || isSpoilerHidden;
  const hiddenLabel = sensitive.isHidden
    ? t("sensitive_content")
    : t("spoiler_reveal");

  const handleClick = () => {
    if (sensitive.isHidden) {
      sensitive.requestReveal(() => onOpen(screenshot));
      return;
    }

    if (isSpoilerHidden) {
      reveal();
      return;
    }

    onOpen(screenshot);
  };

  return (
    <>
      <button
        type="button"
        className={cn("screenshot-card__media", {
          "screenshot-card__media--spoiler": isBlurred,
        })}
        onClick={handleClick}
        aria-label={isBlurred ? hiddenLabel : altText}
        title={isBlurred ? undefined : t("open_screenshot")}
      >
        {hasImage ? (
          <ProgressiveScreenshotImage
            className="screenshot-card__image"
            thumbHash={screenshot.thumbHash}
            sources={[imageUrl]}
            alt={altText}
            loading="lazy"
            onError={() => void handleImageError()}
          />
        ) : (
          <span className="screenshot-card__placeholder">
            <ImageIcon size={28} />
          </span>
        )}

        {isBlurred ? (
          <span className="screenshot-card__spoiler">
            {sensitive.isHidden ? (
              <ShieldIcon size={18} />
            ) : (
              <EyeClosedIcon size={18} />
            )}
            <span>{hiddenLabel}</span>
          </span>
        ) : (
          <span className="screenshot-card__hover">
            <SearchIcon size={22} />
          </span>
        )}
      </button>

      <SensitiveScreenshotModal {...sensitive.modalProps} />
    </>
  );
}

function ScreenshotCardDetails({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const { t } = useTranslation("screenshots");
  const { formatDateTime, formatDistance } = useDate();
  const timestamp = screenshot.capturedAt;

  return (
    <div className="screenshot-card__details">
      <ScreenshotGameLabel screenshot={screenshot} />
      <time
        className="screenshot-card__date"
        dateTime={new Date(timestamp).toISOString()}
        title={t("captured_on", { date: formatDateTime(timestamp) })}
      >
        {formatDistance(new Date(timestamp), new Date(), { addSuffix: true })}
      </time>
    </div>
  );
}

function ScreenshotCardOverlay({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const { t } = useTranslation("screenshots");
  const { formatDateTime, formatDistance } = useDate();
  const timestamp = screenshot.createdAt;

  return (
    <div className="screenshot-card__overlay">
      <Link
        className="screenshot-card__glass screenshot-card__glass--author"
        to={`/profile/${encodeURIComponent(screenshot.owner.id)}`}
      >
        <Avatar size={18} src={screenshot.owner.profileImageUrl} alt="" />
        <span className="screenshot-card__author-name">
          {screenshot.owner.displayName}
        </span>
      </Link>
      <time
        className="screenshot-card__glass screenshot-card__glass--date"
        dateTime={new Date(timestamp).toISOString()}
        title={t("uploaded_on", { date: formatDateTime(timestamp) })}
      >
        {formatDistance(new Date(timestamp), new Date(), { addSuffix: true })}
      </time>
    </div>
  );
}

export function ScreenshotCard({
  screenshot,
  variant,
  isOwner,
  isLiking,
  showCommentCount,
  onOpen,
  onLike,
  onImageError,
}: Readonly<ScreenshotCardProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDate } = useDate();
  const isApproved = isScreenshotApproved(screenshot);
  const altText = t("screenshot_alt", {
    game: getScreenshotGameTitle(screenshot, t),
    date: formatDate(screenshot.capturedAt),
  });

  return (
    <li className={cn("screenshot-card", `screenshot-card--${variant}`)}>
      <ScreenshotCardMedia
        screenshot={screenshot}
        altText={altText}
        onOpen={onOpen}
        onImageError={onImageError}
      />

      {isOwner ? <ScreenshotOwnerBadges screenshot={screenshot} /> : null}

      <ScreenshotStats
        screenshot={screenshot}
        isLikeDisabled={isLiking || !isApproved}
        showCommentCount={showCommentCount}
        className="screenshot-card__actions"
        onLike={onLike}
      />

      {variant === "profile" ? (
        <ScreenshotCardDetails screenshot={screenshot} />
      ) : null}
      {variant === "game" ? (
        <ScreenshotCardOverlay screenshot={screenshot} />
      ) : null}
    </li>
  );
}
