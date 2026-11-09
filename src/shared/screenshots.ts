import type {
  ProfileScreenshot,
  ScreenshotComment,
  ScreenshotCommentReportReason,
  ScreenshotCommentVoteType,
  ScreenshotReportReason,
  ScreenshotReportValues,
  ScreenshotShop,
  ScreenshotSort,
  ScreenshotUpdateRequest,
} from "@types";

export const SCREENSHOTS_PAGE_SIZE = 24;
export const SCREENSHOT_COMMENTS_PAGE_SIZE = 20;
export const SCREENSHOT_COMMENT_MAX_LENGTH = 500;
export const SCREENSHOT_COMMENT_HTML_MAX_LENGTH = 5000;
export const SCREENSHOT_REPORT_DESCRIPTION_MAX_LENGTH = 255;

export const SCREENSHOT_REPORT_REASONS: ScreenshotReportReason[] = [
  "hate",
  "sexual_content",
  "violence",
  "spam",
  "not_game_screenshot",
  "personal_information",
  "other",
];

export const SCREENSHOT_COMMENT_REPORT_REASONS: ScreenshotCommentReportReason[] =
  [
    "hate",
    "sexual_content",
    "violence",
    "spam",
    "personal_information",
    "other",
  ];

export const SCREENSHOT_NOTIFICATION_TYPES = [
  "SCREENSHOT_LIKE",
  "SCREENSHOT_COMMENT",
  "SCREENSHOT_COMMENT_UPVOTE",
] as const;

export type ScreenshotNotificationType =
  (typeof SCREENSHOT_NOTIFICATION_TYPES)[number];

export const isScreenshotNotificationType = (
  type: string
): type is ScreenshotNotificationType =>
  (SCREENSHOT_NOTIFICATION_TYPES as readonly string[]).includes(type);

export const isScreenshotSort = (value: unknown): value is ScreenshotSort =>
  value === "recent" || value === "top";

type QueryValue = string | number | null | undefined;

const PROFILE_SCREENSHOTS_PATH = "/profile/screenshots";

const withQuery = (path: string, query: Record<string, QueryValue>) => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
};

const userScreenshotsBasePath = (userId: string) =>
  `/users/${encodeURIComponent(userId)}/screenshots`;

export interface UserScreenshotsPathOptions {
  userId: string;
  cursor?: string | null;
  take?: number;
  sort?: ScreenshotSort;
  shop?: ScreenshotShop | null;
  objectId?: string | null;
}

export const buildUserScreenshotsPath = ({
  userId,
  cursor,
  take = SCREENSHOTS_PAGE_SIZE,
  sort = "recent",
  shop,
  objectId,
}: UserScreenshotsPathOptions) =>
  withQuery(userScreenshotsBasePath(userId), {
    take,
    cursor,
    sort,
    shop,
    objectId: shop === "custom" ? null : objectId,
  });

export const buildProfileGameScreenshotsPath = ({
  shop,
  objectId,
}: {
  shop: ScreenshotShop;
  objectId: string;
}) => withQuery(PROFILE_SCREENSHOTS_PATH, { shop, objectId });

export const buildUserScreenshotGamesPath = (userId: string) =>
  `${userScreenshotsBasePath(userId)}/games`;

export const buildUserScreenshotPath = (userId: string, screenshotId: string) =>
  `${userScreenshotsBasePath(userId)}/${encodeURIComponent(screenshotId)}`;

export const buildUserScreenshotLikePath = (
  userId: string,
  screenshotId: string
) => `${buildUserScreenshotPath(userId, screenshotId)}/like`;

export const buildUserScreenshotReportPath = (
  userId: string,
  screenshotId: string
) => `${buildUserScreenshotPath(userId, screenshotId)}/report`;

export type ScreenshotCommentSort = "newest" | "top";

export interface ScreenshotCommentsPathOptions {
  cursor?: string | null;
  take?: number;
  sort?: ScreenshotCommentSort;
}

export const buildUserScreenshotCommentsPath = (
  userId: string,
  screenshotId: string,
  { cursor, take, sort }: ScreenshotCommentsPathOptions = {}
) =>
  withQuery(`${buildUserScreenshotPath(userId, screenshotId)}/comments`, {
    take,
    cursor,
    sort: sort === "top" ? sort : undefined,
  });

export const buildUserScreenshotCommentPath = (
  userId: string,
  screenshotId: string,
  commentId: string
) =>
  `${buildUserScreenshotPath(userId, screenshotId)}/comments/${encodeURIComponent(commentId)}`;

export const buildUserScreenshotCommentVotePath = (
  userId: string,
  screenshotId: string,
  commentId: string,
  vote: ScreenshotCommentVoteType
) =>
  `${buildUserScreenshotCommentPath(userId, screenshotId, commentId)}/${vote === "UPVOTE" ? "upvote" : "downvote"}`;

export const buildUserScreenshotCommentReportPath = (
  userId: string,
  screenshotId: string,
  commentId: string
) =>
  `${buildUserScreenshotCommentPath(userId, screenshotId, commentId)}/report`;

export interface GameScreenshotsPathOptions {
  shop: ScreenshotShop;
  objectId: string;
  cursor?: string | null;
  take?: number;
  sort?: ScreenshotSort;
}

export const buildGameScreenshotsPath = ({
  shop,
  objectId,
  cursor,
  take = SCREENSHOTS_PAGE_SIZE,
  sort = "recent",
}: GameScreenshotsPathOptions) =>
  withQuery(
    `/games/${encodeURIComponent(shop)}/${encodeURIComponent(objectId)}/screenshots`,
    { take, cursor, sort }
  );

export const buildProfileScreenshotPath = (screenshotId: string) =>
  `${PROFILE_SCREENSHOTS_PATH}/${encodeURIComponent(screenshotId)}`;

export const SCREENSHOT_API_ERROR_CODES = [
  "screenshots/not-found",
  "screenshots/private",
  "screenshots/comment-not-found",
  "screenshots/comments-disabled",
  "screenshots/comment-not-allowed",
  "screenshots/comment-rate-limited",
  "screenshots/report-rate-limited",
  "screenshots/already-reported",
  "screenshots/cannot-report-own",
  "screenshots/game-deletion-rate-limited",
  "screenshots/comment-rate-limit-unavailable",
  "screenshots/text-change-rate-limit-unavailable",
  "screenshots/moderation-in-progress",
] as const;

export type ScreenshotApiErrorCode =
  (typeof SCREENSHOT_API_ERROR_CODES)[number];

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
};

export const getScreenshotApiErrorCode = (
  error: unknown
): ScreenshotApiErrorCode | null => {
  const message = getErrorMessage(error);

  return (
    SCREENSHOT_API_ERROR_CODES.find((code) => message.includes(code)) ?? null
  );
};

const revealedSpoilerIds = new Set<string>();
const spoilerRevealListeners = new Set<() => void>();

export const isScreenshotSpoilerRevealed = (screenshotId: string) =>
  revealedSpoilerIds.has(screenshotId);

export const revealScreenshotSpoiler = (screenshotId: string) => {
  if (revealedSpoilerIds.has(screenshotId)) return;

  revealedSpoilerIds.add(screenshotId);
  for (const listener of spoilerRevealListeners) listener();
};

export const subscribeScreenshotSpoilerReveals = (listener: () => void) => {
  spoilerRevealListeners.add(listener);
  return () => {
    spoilerRevealListeners.delete(listener);
  };
};

export const isScreenshotSpoilerHidden = (
  screenshot: Pick<ProfileScreenshot, "id" | "isSpoiler">
) => screenshot.isSpoiler && !isScreenshotSpoilerRevealed(screenshot.id);

const revealedSensitiveIds = new Set<string>();
const sensitiveRevealListeners = new Set<() => void>();

export const revealSensitiveScreenshot = (screenshotId: string) => {
  if (revealedSensitiveIds.has(screenshotId)) return;

  revealedSensitiveIds.add(screenshotId);
  for (const listener of sensitiveRevealListeners) listener();
};

export const subscribeSensitiveScreenshotReveals = (listener: () => void) => {
  sensitiveRevealListeners.add(listener);
  return () => {
    sensitiveRevealListeners.delete(listener);
  };
};

export interface SensitiveScreenshotViewer {
  viewerId: string | null;
  showSensitive: boolean;
}

export const isSensitiveScreenshotHidden = (
  screenshot: Pick<ProfileScreenshot, "id" | "isSensitive" | "owner">,
  { viewerId, showSensitive }: SensitiveScreenshotViewer
) =>
  screenshot.isSensitive === true &&
  !showSensitive &&
  screenshot.owner.id !== viewerId &&
  !revealedSensitiveIds.has(screenshot.id);

export const getToggledScreenshotLike = (
  screenshot: Pick<ProfileScreenshot, "likeCount" | "likedByMe">
): Pick<ProfileScreenshot, "likeCount" | "likedByMe"> => {
  const likedByMe = !screenshot.likedByMe;

  return {
    likedByMe,
    likeCount: Math.max(0, screenshot.likeCount + (likedByMe ? 1 : -1)),
  };
};

export const pickCommentEditPatch = ({
  bodyHtml,
  editedAt,
  isHidden,
  moderation,
}: ScreenshotComment): Partial<ScreenshotComment> => ({
  bodyHtml,
  editedAt,
  isHidden,
  ...(moderation === undefined ? {} : { moderation }),
});

export const getVotedScreenshotComment = (
  comment: Pick<ScreenshotComment, "upvotes" | "downvotes" | "myVote">,
  vote: ScreenshotCommentVoteType
): Pick<ScreenshotComment, "upvotes" | "downvotes" | "myVote"> => {
  const isRemovingVote = comment.myVote === vote;
  const myVote = isRemovingVote ? null : vote;
  let { upvotes, downvotes } = comment;

  if (comment.myVote === "UPVOTE") upvotes -= 1;
  if (comment.myVote === "DOWNVOTE") downvotes -= 1;
  if (myVote === "UPVOTE") upvotes += 1;
  if (myVote === "DOWNVOTE") downvotes += 1;

  return {
    upvotes: Math.max(0, upvotes),
    downvotes: Math.max(0, downvotes),
    myVote,
  };
};

const COMMENT_LINE_BREAK_RUN = /(?:<br\s*\/?>\s*){2,}/gi;
const COMMENT_PARAGRAPH_LEADING_BREAKS = /<p>(?:\s*<br\s*\/?>)+/gi;
const COMMENT_PARAGRAPH_TRAILING_BREAKS = /(?:<br\s*\/?>\s*)+<\/p>/gi;
const COMMENT_EMPTY_PARAGRAPH = String.raw`<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>\s*`;
const COMMENT_EMPTY_PARAGRAPH_RUN = new RegExp(
  `(?:${COMMENT_EMPTY_PARAGRAPH}){2,}`,
  "gi"
);
const COMMENT_EDGE_EMPTY_PARAGRAPHS = new RegExp(
  `^(?:${COMMENT_EMPTY_PARAGRAPH})+|(?:${COMMENT_EMPTY_PARAGRAPH})+$`,
  "gi"
);

export const normalizeScreenshotCommentBody = (body: string) =>
  body
    .replaceAll("\r\n", "\n")
    .replaceAll(COMMENT_LINE_BREAK_RUN, "<br>")
    .replaceAll(COMMENT_PARAGRAPH_LEADING_BREAKS, "<p>")
    .replaceAll(COMMENT_PARAGRAPH_TRAILING_BREAKS, "</p>")
    .replaceAll(COMMENT_EMPTY_PARAGRAPH_RUN, "<p></p>")
    .trim()
    .replaceAll(COMMENT_EDGE_EMPTY_PARAGRAPHS, "")
    .trim();

export const normalizeScreenshotReportValues = <
  Reason extends ScreenshotReportReason,
>({
  reason,
  description,
}: ScreenshotReportValues<Reason>): ScreenshotReportValues<Reason> => {
  const trimmedDescription = description?.trim();

  return {
    reason,
    ...(trimmedDescription ? { description: trimmedDescription } : {}),
  };
};

export const mergeScreenshotPages = <Item extends { id: string }>(
  current: Item[],
  next: Item[]
) => {
  const knownIds = new Set(current.map((item) => item.id));
  return [...current, ...next.filter((item) => !knownIds.has(item.id))];
};

export const buildScreenshotNotificationTarget = (
  profileTarget: string,
  variables: Record<string, string>
) => {
  const [pathname, query = ""] = profileTarget.split("?");
  const params = new URLSearchParams(query);
  const ownerId = variables.ownerId ?? params.get("userId");
  const profilePath =
    pathname.startsWith("/profile/") || !ownerId
      ? pathname
      : `/profile/${encodeURIComponent(ownerId)}`;

  params.delete("userId");
  params.set("tab", "screenshots");
  if (variables.screenshotId) params.set("screenshot", variables.screenshotId);

  return `${profilePath}?${params.toString()}`;
};

export const getEditedScreenshotFields = (
  update: ScreenshotUpdateRequest,
  response: ProfileScreenshot | null
): Partial<ProfileScreenshot> => {
  const source = response ?? {
    ...update,
    gameTitle: update.customGameTitle,
  };
  const patch: Partial<ProfileScreenshot> = {};

  if (update.visibility !== undefined) patch.visibility = source.visibility;
  if (update.isSpoiler !== undefined) patch.isSpoiler = source.isSpoiler;
  if (update.commentsEnabled !== undefined) {
    patch.commentsEnabled = source.commentsEnabled;
    if (response) patch.canComment = response.canComment;
  }
  if (update.customGameTitle !== undefined) {
    patch.gameTitle = source.gameTitle ?? null;
  }
  if (update.description !== undefined) {
    patch.description = source.description ?? null;
    if (response) {
      patch.descriptionModerationStatus =
        response.descriptionModerationStatus ?? null;
    }
  }

  return patch;
};
