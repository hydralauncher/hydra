export type GameShop = "steam" | "epic" | "custom";

export type ShortcutLocation = "desktop" | "start_menu";

export interface UnlockedAchievement {
  name: string;
  unlockTime: number;
  imageUrl?: string | null;
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
  imageUrl?: string | null;
}
