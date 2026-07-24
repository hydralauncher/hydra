import type { GameShop, UserAchievement } from "./game.types";

export interface HydraOverlayPreferences {
  overlayEnabled: boolean;
  overlayPerformanceEnabled: boolean;
  overlayPerformanceShowFps: boolean;
  overlayPerformanceShowAverageFps: boolean;
  overlayPerformanceShowFrameTime: boolean;
  overlayPerformanceShowOnePercentLow: boolean;
}

export interface HydraOverlayPerformanceRows {
  fps: boolean;
  averageFps: boolean;
  frameTime: boolean;
  onePercentLow: boolean;
}

export interface HydraOverlayGame {
  title: string;
  objectId: string;
  shop: GameShop;
  iconUrl: string | null;
  logoImageUrl: string | null;
  heroImageUrl: string | null;
  coverImageUrl: string | null;
  playTimeInMilliseconds: number;
  sessionStartedAt: number;
}

export interface HydraOverlayContext {
  game: HydraOverlayGame;
  user: {
    displayName: string;
    profileImageUrl: string | null;
  } | null;
  achievements: UserAchievement[];
  shortcut: string;
  controllerShortcut: string;
  performance: HydraOverlayPerformance;
  performancePinned: boolean;
  settings: HydraOverlaySettings;
}

export interface HydraOverlaySettings {
  performanceEnabled: boolean;
  performanceRows: HydraOverlayPerformanceRows;
}

export interface HydraOverlayPerformance {
  fps: number | null;
  averageFps: number | null;
  onePercentLow: number | null;
  frameTimeMs: number | null;
  updatedAt: number;
}

export type HydraOverlayGamepadAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "accept"
  | "back"
  | "previous-tab"
  | "next-tab";
