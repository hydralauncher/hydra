import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { CommentIcon, HeartFillIcon, HeartIcon } from "@primer/octicons-react";
import cn from "classnames";

import type { ProfileScreenshot } from "@types";

import "./screenshot-stats.scss";

const LIKE_TAP_SCALE = 0.92;

interface ScreenshotLikeButtonProps {
  screenshot: ProfileScreenshot;
  isDisabled: boolean;
  onLike: (screenshot: ProfileScreenshot) => void;
}

export function ScreenshotLikeButton({
  screenshot,
  isDisabled,
  onLike,
}: Readonly<ScreenshotLikeButtonProps>) {
  const { t } = useTranslation("screenshots");
  const label = t(screenshot.likedByMe ? "unlike" : "like");

  return (
    <motion.button
      type="button"
      className={cn("screenshot-stat-chip screenshot-stat-chip--button", {
        "screenshot-stat-chip--active": screenshot.likedByMe,
      })}
      onClick={() => onLike(screenshot)}
      disabled={isDisabled}
      aria-pressed={screenshot.likedByMe}
      aria-label={label}
      title={label}
      whileTap={{ scale: LIKE_TAP_SCALE }}
    >
      {screenshot.likedByMe ? (
        <HeartFillIcon size={14} />
      ) : (
        <HeartIcon size={14} />
      )}
      <span>{screenshot.likeCount}</span>
    </motion.button>
  );
}

interface ScreenshotCommentCountProps {
  count: number;
  className?: string;
}

export function ScreenshotCommentCount({
  count,
  className,
}: Readonly<ScreenshotCommentCountProps>) {
  const { t } = useTranslation("screenshots");
  const label = t("comments_title", { count });

  return (
    <span
      className={cn("screenshot-stat-chip", className)}
      title={label}
      aria-label={label}
    >
      <CommentIcon size={14} />
      <span>{count}</span>
    </span>
  );
}

interface ScreenshotStatsProps {
  screenshot: ProfileScreenshot;
  isLikeDisabled: boolean;
  showCommentCount: boolean;
  className?: string;
  onLike: (screenshot: ProfileScreenshot) => void;
}

export function ScreenshotStats({
  screenshot,
  isLikeDisabled,
  showCommentCount,
  className,
  onLike,
}: Readonly<ScreenshotStatsProps>) {
  return (
    <div className={cn("screenshot-stats", className)}>
      <ScreenshotLikeButton
        screenshot={screenshot}
        isDisabled={isLikeDisabled}
        onLike={onLike}
      />
      {showCommentCount ? (
        <ScreenshotCommentCount count={screenshot.commentCount} />
      ) : null}
    </div>
  );
}
