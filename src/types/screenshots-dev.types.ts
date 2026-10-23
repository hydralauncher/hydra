import type { GameShop } from "./game.types";
import type { ScreenshotInputStatus } from "./screenshot.types";

export type ScreenshotsDevImageSource =
  | { kind: "pattern"; width: number; height: number }
  | { kind: "file"; path: string };

export interface ScreenshotsDevGame {
  shop: GameShop;
  objectId: string;
  title: string;
  isRunning: boolean;
}

export interface ScreenshotsDevCaptureRequest {
  game: Pick<ScreenshotsDevGame, "shop" | "objectId" | "title">;
  image: ScreenshotsDevImageSource;
  signedOut: boolean;
  adult: boolean;
}

export interface ScreenshotsDevBurstRequest
  extends ScreenshotsDevCaptureRequest {
  count: number;
}

export type ScreenshotsDevFeedbackKind =
  | "sound"
  | "captured"
  | "saved_locally"
  | "disabled_for_game";

export type ScreenshotsDevModerationOutcome =
  | "APPROVED"
  | "BLOCKED"
  | "WITHHELD";

export type ScreenshotsDevUploadFailure =
  | "tier_limit"
  | "disabled_for_game"
  | "limit_reached"
  | "blocked_limit_reached"
  | "game_not_found"
  | "network"
  | "already_uploaded";

export type ScreenshotsDevError =
  | "not_found"
  | "not_uploaded"
  | "big_picture_closed"
  | "failed";

export interface ScreenshotsDevResult {
  ok: boolean;
  error?: ScreenshotsDevError;
  count?: number;
}

export interface ScreenshotsDevInputResult {
  triggered: boolean;
  status: ScreenshotInputStatus;
}

export interface ScreenshotsDevApi {
  listGames: () => Promise<ScreenshotsDevGame[]>;
  capture: (
    request: ScreenshotsDevCaptureRequest
  ) => Promise<ScreenshotsDevResult>;
  burst: (request: ScreenshotsDevBurstRequest) => Promise<ScreenshotsDevResult>;
  closeGame: (
    shop: GameShop,
    objectId: string
  ) => Promise<ScreenshotsDevResult>;
  feedback: (kind: ScreenshotsDevFeedbackKind) => Promise<ScreenshotsDevResult>;
  moderation: (
    clientId: string,
    outcome: ScreenshotsDevModerationOutcome,
    reason: string | null
  ) => Promise<ScreenshotsDevResult>;
  uploadFailure: (
    clientId: string,
    failure: ScreenshotsDevUploadFailure
  ) => Promise<ScreenshotsDevResult>;
  triggerInput: () => Promise<ScreenshotsDevInputResult>;
  inputStatus: () => Promise<ScreenshotInputStatus>;
  bigPictureReview: (clientIds: string[]) => Promise<ScreenshotsDevResult>;
  deleteCaptures: () => Promise<ScreenshotsDevResult>;
}
