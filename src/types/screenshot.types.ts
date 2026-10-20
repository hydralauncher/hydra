import type { GameShop } from "./game.types";
import type { ProfileVisibility } from "./index";

export type ScreenshotShop = GameShop;
export type ScreenshotModerationStatus = "PENDING" | "APPROVED" | "BLOCKED";
export type ScreenshotQuality = "STANDARD" | "CLOUD";
export type ScreenshotCommentsPolicy = "EVERYONE" | "FRIENDS" | "NOBODY";
export type ScreenshotSort = "recent" | "top";
export type ScreenshotsHiddenReason = "FRIENDS_ONLY" | "PRIVATE" | null;
export type ScreenshotCommentVoteType = "UPVOTE" | "DOWNVOTE";

export type ScreenshotReportReason =
  | "hate"
  | "sexual_content"
  | "violence"
  | "spam"
  | "other"
  | "not_game_screenshot"
  | "personal_information";

export type ScreenshotCommentReportReason = Exclude<
  ScreenshotReportReason,
  "not_game_screenshot"
>;

export interface ScreenshotAuthor {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
}

export interface ProfileScreenshot {
  id: string;
  owner: ScreenshotAuthor;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  capturedAt: number;
  createdAt: number;
  shop: ScreenshotShop;
  objectId: string | null;
  isCustomGame: boolean;
  gameTitle: string | null;
  gameIconUrl: string | null;
  isSpoiler: boolean;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  commentsEnabled: boolean;
  canComment: boolean;
  visibility?: ProfileVisibility;
  moderationStatus?: ScreenshotModerationStatus;
  moderationReason?: string | null;
}

export interface ScreenshotsResponse {
  items: ProfileScreenshot[];
  total: number;
  hiddenReason: ScreenshotsHiddenReason;
  nextCursor: string | null;
}

export interface GameScreenshotsResponse {
  items: ProfileScreenshot[];
  nextCursor: string | null;
}

export interface ScreenshotGameFilterItem {
  shop: ScreenshotShop;
  objectId: string | null;
  title: string | null;
  iconUrl: string | null;
  count: number;
}

export interface ScreenshotGamesResponse {
  items: ScreenshotGameFilterItem[];
}

export interface ScreenshotPresignRequest {
  clientId: string;
  quality: ScreenshotQuality;
  imageLength: number;
  thumbnailLength: number;
  width: number;
  height: number;
  shop: ScreenshotShop;
  objectId?: string;
  customGameTitle?: string;
  capturedAt: number;
  isSpoiler?: boolean;
  visibility?: ProfileVisibility;
}

export interface ScreenshotPresignResponse {
  id: string;
  presignedUrl: string;
  thumbnailPresignedUrl: string;
  expiresAt: number;
}

export interface ScreenshotModerationState {
  id: string;
  moderationStatus: ScreenshotModerationStatus;
  moderationReason: string | null;
}

export interface ScreenshotUpdateRequest {
  visibility?: ProfileVisibility;
  commentsEnabled?: boolean;
  isSpoiler?: boolean;
  customGameTitle?: string | null;
}

export interface ScreenshotLikeResponse {
  likeCount: number;
  likedByMe: boolean;
}

export interface ScreenshotComment {
  id: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
  author: ScreenshotAuthor;
  upvotes: number;
  downvotes: number;
  myVote: ScreenshotCommentVoteType | null;
  isHidden: boolean;
  isOwn: boolean;
  canDelete: boolean;
}

export interface ScreenshotCommentsResponse {
  items: ScreenshotComment[];
  total: number;
  nextCursor: string | null;
}

export interface ScreenshotCommentVoteResponse {
  upvotes: number;
  downvotes: number;
  myVote: ScreenshotCommentVoteType | null;
}

export type ScreenshotTriggerSource = "keyboard" | "gamepad" | "deeplink";

export interface ScreenshotHotkeyBinding {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export type ScreenshotGamepadButton =
  | "a"
  | "b"
  | "x"
  | "y"
  | "lb"
  | "rb"
  | "lt"
  | "rt"
  | "back"
  | "start"
  | "ls"
  | "rs"
  | "dpadUp"
  | "dpadDown"
  | "dpadLeft"
  | "dpadRight";

export type ScreenshotInputBackend =
  | "windows-raw-input"
  | "xinput"
  | "x11-xinput2"
  | "evdev"
  | "unavailable";

export type ScreenshotInputHint =
  | "gamepad_unavailable"
  | "hotkey_unavailable"
  | "hotkey_unavailable_wayland"
  | "hotkey_xwayland_only";

export interface ScreenshotInputStatus {
  active: boolean;
  keyboardBackend: ScreenshotInputBackend;
  gamepadBackend: ScreenshotInputBackend;
  hint: ScreenshotInputHint | null;
}

export type LocalScreenshotState =
  | "local"
  | "reviewing"
  | "queued"
  | "uploading"
  | "uploaded"
  | "failed"
  | "deleted";

export interface LocalScreenshot {
  clientId: string;
  ownerId: string | null;
  shop: ScreenshotShop;
  objectId: string | null;
  gameTitle: string;
  customGameTitle: string | null;
  path: string;
  capturedAt: number;
  width: number;
  height: number;
  state: LocalScreenshotState;
  isSpoiler: boolean;
  visibility: ProfileVisibility;
  screenshotId: string | null;
  moderationStatus: ScreenshotModerationStatus | null;
  moderationReason: string | null;
  uploadProgress: number | null;
  lastError: string | null;
  gameSessionId: string | null;
  uploadQuality?: ScreenshotQuality | null;
  uploadClientId?: string | null;
  uploadAttempts?: number;
  nextUploadAttemptAt?: number | null;
  uploadedAt?: number | null;
}

export interface LocalScreenshotUploadOptions {
  isSpoiler: boolean;
  visibility: ProfileVisibility;
  customGameTitle: string | null;
}

export interface ScreenshotUploadProgress {
  clientId: string;
  state: LocalScreenshotState;
  progress: number | null;
}

export interface ScreenshotReviewRequest {
  gameKey: string;
  shop: ScreenshotShop;
  objectId: string;
  gameTitle: string;
  clientIds: string[];
}

export type ScreenshotTelemetryEventType = "capture" | "upload" | "review";

export interface ScreenshotTelemetryEvent {
  type: ScreenshotTelemetryEventType;
  outcome: string;
  reason?: string;
  platform: "win32" | "linux";
  count: number;
}

export type ScreenshotFeedbackToast =
  | { kind: "captured"; gameTitle: string; thumbnailPath: string }
  | { kind: "saved_locally"; gameTitle: string; thumbnailPath: string }
  | { kind: "disabled_for_game"; gameTitle: string };
