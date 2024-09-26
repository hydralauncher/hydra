export enum Cracker {
  codex = "CODEX",
  rune = "RUNE",
  onlineFix = "OnlineFix",
  goldberg = "Goldberg",
}

export interface CheckedAchievements {
  all: Achievement[];
  new: Achievement[];
}

export interface UnlockedAchievement {
  name: string;
  unlockTime: number;
}

export interface Achievement {
  id: string;
  percent: number;
  imageUrl: string;
  title: string;
  description: string;
  achieved: boolean;
  curProgress: number;
  maxProgress: number;
  unlockTime: number;
}

export interface AchievementInfo {
  imageUrl: string;
  title: string;
  description: string;
}

export interface AchievementPercentage {
  name: string;
  percent: number;
}

export interface CheckedAchievement {
  all: Achievement[];
  new: Achievement[];
}

export interface AchievementFile {
  type: Cracker;
  filePath: string;
}

export type GameAchievementFiles = {
  [id: string]: AchievementFile[];
};

export type GameAchievementFile = {
  [id: string]: AchievementFile[];
};
