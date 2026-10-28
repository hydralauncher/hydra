import "./screenshot-card.scss";

import {
  ChatCircleIcon,
  EyeClosedIcon,
  GameControllerIcon,
  HeartIcon,
  ImageIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot } from "@types";
import { useScreenshotImageFallback } from "@shared";

import { FocusItem, UserProfileAvatar } from "../../common";
import type { FocusOverrides } from "../../../services";
import { Feature, useDate, useFeature } from "../../../hooks";
import {
  getScreenshotAltText,
  getScreenshotBlurReason,
  getScreenshotGameTitle,
  shouldBlurScreenshot,
} from "./helpers";
import { ProgressiveScreenshotImage } from "./progressive-screenshot-image";
import { ScreenshotBlurLabel } from "./screenshot-blur-label";
import { useRevealedScreenshotSpoilers } from "./use-revealed-spoilers";
import { useSensitiveScreenshotGate } from "./use-sensitive-screenshot-gate";

export type ScreenshotCardMetaPlacement = "below" | "overlay" | "none";

export interface ScreenshotCardProps {
  screenshot: ProfileScreenshot;
  focusId: string;
  showOwnerDetails: boolean;
  showAuthor: boolean;
  metaPlacement?: ScreenshotCardMetaPlacement;
  navigationOverrides?: FocusOverrides;
  isLikePending?: boolean;
  onActivate: (screenshot: ProfileScreenshot) => void;
  onLike?: (screenshot: ProfileScreenshot) => void;
  onRefreshImage?: (screenshot: ProfileScreenshot) => Promise<void>;
}

interface ScreenshotCardLikeProps {
  screenshot: ProfileScreenshot;
  isPending: boolean;
  canLike: boolean;
  onLike?: (screenshot: ProfileScreenshot) => void;
}

function ScreenshotCardLike({
  screenshot,
  isPending,
  canLike,
  onLike,
}: Readonly<ScreenshotCardLikeProps>) {
  const { t } = useTranslation("big_picture");
  const count = (
    <AnimatePresence mode="wait">
      <motion.span
        key={screenshot.likeCount}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
      >
        {screenshot.likeCount}
      </motion.span>
    </AnimatePresence>
  );
  const icon = (
    <HeartIcon size={18} weight={screenshot.likedByMe ? "fill" : "regular"} />
  );

  if (!onLike) {
    return (
      <span className="screenshot-card__stat">
        {icon}
        {count}
      </span>
    );
  }

  const label = t(
    screenshot.likedByMe ? "screenshots_unlike" : "screenshots_like"
  );

  return (
    <motion.button
      type="button"
      className={cn("screenshot-card__stat screenshot-card__stat--button", {
        "screenshot-card__stat--pending": isPending,
      })}
      disabled={!canLike}
      onClick={(event) => {
        event.stopPropagation();
        onLike(screenshot);
      }}
      aria-label={label}
      aria-pressed={screenshot.likedByMe}
      title={label}
      tabIndex={-1}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      {icon}
      {count}
    </motion.button>
  );
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
          <UsersIcon size={18} weight="bold" />
        </span>
      ) : null}

      {screenshot.visibility === "PRIVATE" ? (
        <span
          className="screenshot-card__badge screenshot-card__badge--icon"
          title={t("screenshots_visibility_private")}
          aria-label={t("screenshots_visibility_private")}
        >
          <EyeClosedIcon size={18} weight="bold" />
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

function ScreenshotCardOverlay({
  screenshot,
}: Readonly<{ screenshot: ProfileScreenshot }>) {
  const { t } = useTranslation("screenshots");
  const { formatDateTime, formatDistance } = useDate();
  const uploadedAt = new Date(screenshot.createdAt);

  return (
    <div className="screenshot-card__overlay">
      <span className="screenshot-card__glass screenshot-card__glass--author">
        <UserProfileAvatar
          image={screenshot.owner.profileImageUrl}
          alt=""
          className="screenshot-card__author-avatar"
          fallbackClassName="screenshot-card__author-avatar--fallback"
          width={22}
          height={22}
          iconSize={12}
        />
        <span className="screenshot-card__meta-text">
          {screenshot.owner.displayName}
        </span>
      </span>
      <time
        className="screenshot-card__glass screenshot-card__glass--date"
        dateTime={uploadedAt.toISOString()}
        title={t("uploaded_on", { date: formatDateTime(uploadedAt) })}
      >
        {formatDistance(uploadedAt, new Date(), { addSuffix: true })}
      </time>
    </div>
  );
}

export function ScreenshotCard({
  screenshot,
  focusId,
  showOwnerDetails,
  showAuthor,
  metaPlacement = "below",
  navigationOverrides,
  isLikePending = false,
  onActivate,
  onLike,
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
  const sensitiveGate = useSensitiveScreenshotGate();
  const blurReason = getScreenshotBlurReason(
    sensitiveGate.isHidden(screenshot),
    shouldBlurScreenshot(screenshot, revealedIds)
  );
  const activate = () =>
    sensitiveGate.guard(screenshot, () => onActivate(screenshot));
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const altText = getScreenshotAltText(screenshot, t, language);
  const isApproved =
    screenshot.moderationStatus === undefined ||
    screenshot.moderationStatus === "APPROVED";
  const canLike = Boolean(onLike) && isApproved && !isLikePending;

  return (
    <>
      <FocusItem
        id={focusId}
        actions={{
          primary: activate,
          secondary: canLike ? () => onLike?.(screenshot) : undefined,
        }}
        navigationOverrides={navigationOverrides}
        asChild
      >
        <li className="screenshot-card">
          <button
            type="button"
            className="screenshot-card__open-button"
            aria-label={altText}
            tabIndex={-1}
            onClick={activate}
          />

          <div className="screenshot-card__frame">
            {hasImage && imageUrl ? (
              <ProgressiveScreenshotImage
                className={cn("screenshot-card__image", {
                  "screenshot-card__image--spoiler": blurReason !== null,
                })}
                sources={[imageUrl]}
                thumbHash={screenshot.thumbHash}
                alt={altText}
                loading="lazy"
                onError={() => void handleImageError()}
              />
            ) : (
              <span className="screenshot-card__placeholder">
                <ImageIcon size={36} />
              </span>
            )}

            {blurReason ? (
              <ScreenshotBlurLabel
                className="screenshot-card__spoiler"
                reason={blurReason}
                iconSize={18}
              />
            ) : null}

            <div className="screenshot-card__corner">
              {showOwnerDetails ? (
                <ScreenshotCardBadges screenshot={screenshot} />
              ) : null}

              <div className="screenshot-card__stats">
                <ScreenshotCardLike
                  screenshot={screenshot}
                  isPending={isLikePending}
                  canLike={canLike}
                  onLike={onLike}
                />
                {isFeatureEnabled(Feature.ScreenshotComments) ? (
                  <span className="screenshot-card__stat">
                    <ChatCircleIcon size={18} />
                    {screenshot.commentCount}
                  </span>
                ) : null}
              </div>
            </div>

            {metaPlacement === "overlay" ? (
              <ScreenshotCardOverlay screenshot={screenshot} />
            ) : null}
          </div>

          {metaPlacement === "below" ? (
            <ScreenshotCardMeta
              screenshot={screenshot}
              showAuthor={showAuthor}
            />
          ) : null}
        </li>
      </FocusItem>
      {sensitiveGate.modal}
    </>
  );
}
