import type {
  Game,
  GameAchievement,
  GameRepack,
  GameShop,
  GameStats,
  ShopDetails,
} from "@types";

export interface GameDetailsContext {
  game: Game | null;
  shopDetails: ShopDetails | null;
  repacks: GameRepack[];
  shop: GameShop;
  gameTitle: string;
  isGameRunning: boolean;
  isLoading: boolean;
  objectId: string | undefined;
  gameColor: string;
  showRepacksModal: boolean;
  showGameOptionsModal: boolean;
  stats: GameStats | null;
  achievements: GameAchievement[];
  hasNSFWContentBlocked: boolean;
  setGameColor: React.Dispatch<React.SetStateAction<string>>;
  selectGameExecutable: () => Promise<string | null>;
  updateGame: () => Promise<void>;
  setShowRepacksModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGameOptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
  setHasNSFWContentBlocked: React.Dispatch<React.SetStateAction<boolean>>;
}
