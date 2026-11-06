import type { GameShop } from "./game.types";

export type OverlayHotkeyModifier = "shift" | "alt";

export interface OverlayHotkeyBinding {
  modifier: OverlayHotkeyModifier;
  key: string;
}

export interface OverlayGameInfo {
  gameKey: string;
  shop: GameShop;
  objectId: string;
  title: string;
  iconUrl: string | null;
  achievementCount?: number;
}

/** Big Picture keeps the original full-window tabbed overlay. */
export type OverlayMode = "default" | "bigPicture";

export type OverlayPanel = "chat" | "achievements" | "leaderboard" | "browser";

export type OverlayChatWindowKind = "panel" | "bigPicture";

export interface OverlayBrowserState {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface OverlayPanelStatus {
  panel: OverlayPanel;
  isOpen: boolean;
  isPinned: boolean;
}

export interface OverlayPanelState extends OverlayPanelStatus {
  isVisible: boolean;
  isWarm: boolean;
  isOverlayOpen: boolean;
  isOverlayClosing: boolean;
}

export interface OverlayState {
  isOpen: boolean;
  isClosing: boolean;
  mode: OverlayMode;
  game: OverlayGameInfo | null;
  panels: OverlayPanelStatus[];
}
