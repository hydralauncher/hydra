import type { Game, GameRepack, GameShop, ShopDetails } from "@types";

export interface GameDetailsContext {
  game: Game | null;
  shopDetails: ShopDetails | null;
  repacks: GameRepack[];
  shop: GameShop;
  gameTitle: string;
  isGameRunning: boolean;
  isLoading: boolean;
  objectID: string | undefined;
  gameColor: string;
  showRepacksModal: boolean;
  showGameOptionsModal: boolean;
  setGameColor: React.Dispatch<React.SetStateAction<string>>;
  selectGameExecutable: (
    gameInstallerFolderIfExists?: string
  ) => Promise<string | null>;
  updateGame: () => Promise<void>;
  setShowRepacksModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowGameOptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
}
