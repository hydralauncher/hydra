export type GameShop = "steam" | "custom" | "launchbox";

export type ShortcutLocation = "desktop" | "start_menu";

export interface UnlockedAchievement {
  name: string;
  unlockTime: number;
  hardcoreUnlockTime?: number | null;
  imageKey?: string | null;
}

export interface SteamAchievement {
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  icongray: string;
  hidden: boolean;
  points?: number;
}

export interface UserAchievement extends SteamAchievement {
  unlocked: boolean;
  unlockTime: number | null;
  hardcoreUnlockTime?: number | null;
  source?: "steam" | "retroachievements";
  imageUrl?: string | null;
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
