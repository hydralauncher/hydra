import type {
  LocalScreenshot,
  ProfileScreenshot,
  ScreenshotLikeResponse,
} from "@types";
import {
  getScreenshotModerationReasonKey,
  getScreenshotUploadErrorKey,
  isScreenshotSpoilerRevealed,
} from "@shared";
import { IS_DESKTOP } from "../../../constants";
import { getBigPictureGameDetailsPath } from "../../../helpers";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function getScreenshotGameTitle(
  screenshot: Pick<ProfileScreenshot, "gameTitle" | "isCustomGame">,
  t: Translate
) {
  if (screenshot.gameTitle) return screenshot.gameTitle;

  return screenshot.isCustomGame
    ? t("screenshots_custom_game")
    : t("screenshots_unknown_game");
}

export function formatScreenshotDate(timestamp: number, language: string) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function getScreenshotAltText(
  screenshot: ProfileScreenshot,
  t: Translate,
  language: string
) {
  return t("screenshots_alt_text", {
    game: getScreenshotGameTitle(screenshot, t),
    date: formatScreenshotDate(screenshot.capturedAt, language),
  });
}

export function shouldBlurScreenshot(
  screenshot: Pick<ProfileScreenshot, "id" | "isSpoiler">,
  revealedIds: ReadonlySet<string>
) {
  return (
    screenshot.isSpoiler &&
    !revealedIds.has(screenshot.id) &&
    !isScreenshotSpoilerRevealed(screenshot.id)
  );
}

export type ScreenshotBlurReason = "sensitive" | "spoiler";

export function getScreenshotBlurReason(
  isSensitiveHidden: boolean,
  isSpoilerBlurred: boolean
): ScreenshotBlurReason | null {
  if (isSensitiveHidden) return "sensitive";
  if (isSpoilerBlurred) return "spoiler";
  return null;
}

export function getScreenshotErrorKey(code: string | null) {
  switch (code) {
    case "screenshots/private":
      return "screenshots_error_private";
    case "screenshots/not-found":
      return "screenshots_error_unavailable";
    case "screenshots/comments-disabled":
      return "screenshots_error_comments_disabled";
    case "screenshots/comment-not-allowed":
      return "screenshots_error_comment_not_allowed";
    case "screenshots/comment-rate-limited":
      return "screenshots_error_comment_rate_limited";
    case "screenshots/comment-not-found":
      return "screenshots_error_comment_not_found";
    case "screenshots/already-reported":
      return "screenshots_error_already_reported";
    case "screenshots/report-rate-limited":
      return "screenshots_error_report_rate_limited";
    case "screenshots/cannot-report-own":
      return "screenshots_error_cannot_report_own";
    case "screenshots/comment-rate-limit-unavailable":
      return "screenshots:comments_temporarily_unavailable";
    case "screenshots/text-change-rate-limit-unavailable":
      return "screenshots:text_changes_temporarily_unavailable";
    case "screenshots/moderation-in-progress":
      return "screenshots:moderation_in_progress";
    default:
      return "screenshots_error_generic";
  }
}

export function getLocalScreenshotStatusDetail(
  screenshot: LocalScreenshot | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (screenshot?.state === "failed") {
    return t(getScreenshotUploadErrorKey(screenshot.lastError), {
      ns: "screenshots_capture",
    });
  }

  if (
    screenshot?.state === "uploaded" &&
    screenshot.moderationStatus === "BLOCKED"
  ) {
    return t(getScreenshotModerationReasonKey(screenshot.moderationReason), {
      ns: "screenshots_moderation",
    });
  }

  return null;
}

export function pickNewerScreenshot(
  listItem: ProfileScreenshot | null,
  listFetchedAt: number | null,
  detached: ProfileScreenshot | null,
  detachedFetchedAt: number | null
) {
  if (!listItem || !detached) return listItem ?? detached;

  return (detachedFetchedAt ?? 0) > (listFetchedAt ?? 0) ? detached : listItem;
}

export function getScreenshotGamePath(screenshot: ProfileScreenshot) {
  if (screenshot.isCustomGame || !screenshot.objectId) return null;

  return getBigPictureGameDetailsPath({
    shop: screenshot.shop,
    objectId: screenshot.objectId,
    title: screenshot.gameTitle ?? undefined,
  });
}

export function getScreenshotOwnerPath(ownerId: string) {
  const basePath = IS_DESKTOP ? "/big-picture" : "";

  return `${basePath}/profile/${encodeURIComponent(ownerId)}`;
}

export const getLikePatch = (
  response: ScreenshotLikeResponse
): Partial<ProfileScreenshot> =>
  typeof response.likeCount === "number"
    ? { likedByMe: response.likedByMe, likeCount: response.likeCount }
    : { likedByMe: response.likedByMe };
