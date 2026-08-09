import type {
  GameRepack,
  GameShop,
  GameStats,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";

export type GameOptionsCategoryId =
  | "general"
  | "locations"
  | "assets"
  | "hydra_cloud"
  | "hydra_cloud_legacy"
  | "compatibility"
  | "downloads"
  | "danger_zone";

export interface GameDetailsContext {
  game: LibraryGame | null;
  shopDetails: ShopDetailsWithAssets | null;
  repacks: GameRepack[];
  shop: GameShop;
  gameTitle: string;
  isGameRunning: boolean;
  isLoading: boolean;
  objectId: string | undefined;
  /**
   * The shop/objectId to use for Steam-sourced data (shop details,
   * achievements, stats, reviews, how-long-to-beat). Equal to `shop`/
   * `objectId` normally, but for a custom game matched to a real Steam
   * entry (`game.matchedSteamObjectId`), points at that real entry instead
   * so custom games can show the same Steam-sourced content as any other
   * game.
   */
  steamMatchShop: GameShop;
  steamMatchObjectId: string | undefined;
  showRepacksModal: boolean;
  showGameOptionsModal: boolean;
  gameOptionsInitialCategory: GameOptionsCategoryId;
  stats: GameStats | null;
  achievements: UserAchievement[] | null;
  hasNSFWContentBlocked: boolean;
  lastDownloadedOption: GameRepack | null;
  isTransferring: boolean;
  transferProgress: number;
  selectGameExecutable: () => Promise<string | null>;
  updateGame: () => Promise<void>;
  refreshGameDetails: () => Promise<void>;
  setShowRepacksModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGameOptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
  setGameOptionsInitialCategory: React.Dispatch<
    React.SetStateAction<GameOptionsCategoryId>
  >;
  setHasNSFWContentBlocked: React.Dispatch<React.SetStateAction<boolean>>;
  cancelTransfer: () => void;
}
