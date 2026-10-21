import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EyeClosedIcon,
  ImageIcon,
  LockIcon,
  PeopleIcon,
  SearchIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { Avatar } from "../avatar/avatar";
import { Link } from "../link/link";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useDate } from "@renderer/hooks";
import type { ProfileScreenshot } from "@types";

import { getScreenshotGameTitle } from "./screenshot-labels";
import { ScreenshotStats } from "./screenshot-stats";
import { useScreenshotSpoiler } from "./use-screenshot-spoiler";

import "./screenshot-card.scss";

export type ScreenshotCardVariant = "profile" | "game";

interface ScreenshotCardProps {
  screenshot: ProfileScreenshot;
  variant: ScreenshotCardVariant;
  isOwner: boolean;
  isLiking: boolean;
  showCommentCount: boolean;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onLike: (screenshot: ProfileScreenshot) => void;
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
}

function ScreenshotCardMedia({
  screenshot,
  altText,
  onOpen,
}: Readonly<ScreenshotCardMediaProps>) {
  const { t } = useTranslation("screenshots");
  const { isHidden: isSpoilerHidden, reveal } =
    useScreenshotSpoiler(screenshot);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageUrl = screenshot.thumbnailUrl ?? screenshot.imageUrl;
  const hasImage = Boolean(imageUrl && imageUrl !== failedImageUrl);

  const handleClick = () => {
    if (isSpoilerHidden) {
      reveal();
      return;
    }

    onOpen(screenshot);
  };

  return (
    <button
      type="button"
      className={cn("screenshot-card__media", {
        "screenshot-card__media--spoiler": isSpoilerHidden,
      })}
      onClick={handleClick}
      aria-label={isSpoilerHidden ? t("spoiler_reveal") : altText}
      title={isSpoilerHidden ? undefined : t("open_screenshot")}
    >
      {hasImage ? (
        <img
          className="screenshot-card__image"
          src={imageUrl ?? undefined}
          alt={altText}
          loading="lazy"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <span className="screenshot-card__placeholder">
          <ImageIcon size={28} />
        </span>
      )}

      {isSpoilerHidden ? (
        <span className="screenshot-card__spoiler">
          <EyeClosedIcon size={18} />
          <span>{t("spoiler_reveal")}</span>
        </span>
      ) : (
        <span className="screenshot-card__hover">
          <SearchIcon size={22} />
        </span>
      )}
    </button>
  );
}

interface ScreenshotCardDetailsProps {
  screenshot: ProfileScreenshot;
  variant: ScreenshotCardVariant;
}

function ScreenshotCardDetails({
  screenshot,
  variant,
}: Readonly<ScreenshotCardDetailsProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDateTime, formatDistance } = useDate();
  const isGameFeed = variant === "game";
  const timestamp = isGameFeed ? screenshot.createdAt : screenshot.capturedAt;
  const timeTitle = t(isGameFeed ? "uploaded_on" : "captured_on", {
    date: formatDateTime(timestamp),
  });

  return (
    <div className="screenshot-card__details">
      {isGameFeed ? (
        <Link
          className="screenshot-card__author"
          to={`/profile/${encodeURIComponent(screenshot.owner.id)}`}
        >
          <Avatar size={20} src={screenshot.owner.profileImageUrl} alt="" />
          <span className="screenshot-card__author-name">
            {screenshot.owner.displayName}
          </span>
        </Link>
      ) : (
        <ScreenshotGameLabel screenshot={screenshot} />
      )}
      <time
        className="screenshot-card__date"
        dateTime={new Date(timestamp).toISOString()}
        title={timeTitle}
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
}: Readonly<ScreenshotCardProps>) {
  const { t } = useTranslation("screenshots");
  const { formatDate } = useDate();
  const isApproved =
    !screenshot.moderationStatus || screenshot.moderationStatus === "APPROVED";
  const altText = t("screenshot_alt", {
    game: getScreenshotGameTitle(screenshot, t),
    date: formatDate(screenshot.capturedAt),
  });

  return (
    <li className="screenshot-card">
      <ScreenshotCardMedia
        screenshot={screenshot}
        altText={altText}
        onOpen={onOpen}
      />

      {isOwner ? <ScreenshotOwnerBadges screenshot={screenshot} /> : null}

      <ScreenshotStats
        screenshot={screenshot}
        isLikeDisabled={isLiking || !isApproved}
        showCommentCount={showCommentCount}
        className="screenshot-card__actions"
        onLike={onLike}
      />

      <ScreenshotCardDetails screenshot={screenshot} variant={variant} />
    </li>
  );
}
