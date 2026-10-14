export type GameShop = "steam" | "epic" | "custom" | "launchbox";

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
  externalSetId?: string;
  externalId?: string;
}

export interface UserAchievement extends SteamAchievement {
  unlocked: boolean;
  unlockTime: number | null;
  hardcoreUnlockTime?: number | null;
  source?: "steam" | "epic" | "retroachievements";
  unlockedOn?: {
    hydra: boolean;
    retroachievements: boolean;
    steam: boolean;
    epic?: boolean;
  };
  imageUrl?: string | null;
}
