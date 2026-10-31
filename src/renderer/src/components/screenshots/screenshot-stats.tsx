import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { CommentIcon, HeartFillIcon, HeartIcon } from "@primer/octicons-react";
import cn from "classnames";

import type { ProfileScreenshot } from "@types";

import "./screenshot-stats.scss";

const LIKE_ANIMATION_DURATION_MS = 400;

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
  const [isLikeAnimating, setIsLikeAnimating] = useState(false);
  const label = t(screenshot.likedByMe ? "unlike" : "like");
  const isLocked = isLikeAnimating || isDisabled;

  useEffect(() => {
    if (!isLikeAnimating) return;

    const timeout = setTimeout(
      () => setIsLikeAnimating(false),
      LIKE_ANIMATION_DURATION_MS
    );
    return () => clearTimeout(timeout);
  }, [isLikeAnimating]);

  const handleClick = () => {
    if (isLocked) return;
    setIsLikeAnimating(true);
    onLike(screenshot);
  };

  return (
    <motion.button
      type="button"
      className={cn("screenshot-stat-chip screenshot-stat-chip--button", {
        "screenshot-stat-chip--active": screenshot.likedByMe,
      })}
      onClick={handleClick}
      disabled={isLocked}
      aria-pressed={screenshot.likedByMe}
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      {screenshot.likedByMe ? (
        <HeartFillIcon size={14} />
      ) : (
        <HeartIcon size={14} />
      )}
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
    </motion.button>
  );
}

interface ScreenshotCommentCountProps {
  count: number;
}

export function ScreenshotCommentCount({
  count,
}: Readonly<ScreenshotCommentCountProps>) {
  const { t } = useTranslation("screenshots");
  const label = t("comments_title", { count });

  return (
    <span className="screenshot-stat-chip" title={label} aria-label={label}>
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
