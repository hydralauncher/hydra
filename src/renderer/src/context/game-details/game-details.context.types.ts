import type {
  GameRepack,
  GameShop,
  GameStats,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";

export interface GameDetailsContext {
  game: LibraryGame | null;
  shopDetails: ShopDetailsWithAssets | null;
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
  achievements: UserAchievement[] | null;
  hasNSFWContentBlocked: boolean;
  lastDownloadedOption: GameRepack | null;
  setGameColor: React.Dispatch<React.SetStateAction<string>>;
  selectGameExecutable: () => Promise<string | null>;
  updateGame: () => Promise<void>;
  setShowRepacksModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGameOptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
  setHasNSFWContentBlocked: React.Dispatch<React.SetStateAction<boolean>>;
}
