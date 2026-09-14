export interface PendingSouvenirAchievement {
  name: string;
  unlockTime: number;
  hardcore?: boolean;
}

export interface PendingAchievementSouvenir {
  clientId: string;
  ownerId: string;
  remoteGameId: string;
  gameKey: string;
  screenshotPath: string;
  imageKey?: string;
  uploadedAt?: number;
  capturedAt: number;
  achievements: PendingSouvenirAchievement[];
  status: "pending" | "terminal";
  attemptCount: number;
  lastAttemptAt?: number;
  lastErrorCode?: string;
  lastErrorCount?: number;
  recoveryMode?: "sync_achievements_only";
  recoveryAchievements?: PendingSouvenirAchievement[];
}

export interface AchievementSouvenirSyncStatus {
  pendingCount: number;
  failedCount: number;
  errorCodes: string[];
}

export interface AchievementSouvenirSyncItem {
  clientId: string;
  status: "pending" | "failed";
  screenshotPath: string;
  gameTitle: string | null;
  achievementNames: string[];
  capturedAt: number;
  lastErrorCode?: string;
}

export interface AchievementSouvenirSyncDetails {
  status: AchievementSouvenirSyncStatus;
  items: AchievementSouvenirSyncItem[];
}

export interface AchievementSouvenirSyncRetryResult {
  status: AchievementSouvenirSyncStatus;
  attemptedCount: number;
  syncedCount: number;
  missingScreenshotCount: number;
}

export interface AchievementSouvenirSyncCleanupResult {
  status: AchievementSouvenirSyncStatus;
  deletedCount: number;
  failedFilePaths: string[];
}

export interface LocalSouvenirAsset {
  souvenirId: string;
  clientId: string;
  ownerId: string;
  gameKey: string;
  screenshotPath: string;
}

export type GameContentWarningLevel = "unknown" | "none" | "mature" | "adult";

export type GameContentWarningReason =
  | "age_restricted"
  | "nudity"
  | "sexual_content";

export type GameContentWarningSource = "steam" | "launchbox";

export interface GameContentWarning {
  level: GameContentWarningLevel;
  minimumAge: number | null;
  reasons: GameContentWarningReason[];
  source: GameContentWarningSource | null;
}

export interface AchievementSouvenirUploadAuthorization {
  imageKey: string;
  presignedUrl: string | null;
  status: "pending" | "claimed";
  expiresAt: number | null;
}

export type SouvenirReportReason =
  | "hate"
  | "sexual_content"
  | "violence"
  | "spam"
  | "other";

export interface SouvenirReportValues {
  reason: SouvenirReportReason;
  description?: string;
}
