import type { GameShop } from "./index";

export type ArtworkKind = "grids" | "heroes" | "logos" | "icons";

export type ArtworkAssetType = "grid" | "hero" | "logo" | "icon";

export interface ArtworkAuthor {
  name: string;
  steam64: string;
  avatar: string;
}

export interface ArtworkItem {
  id: number;
  score: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  style?: string;
  nsfw?: boolean;
  humor?: boolean;
  notes?: string | null;
  mime?: string;
  language?: string;
  tags?: string[];
  author?: ArtworkAuthor;
}

export interface ArtworkPage {
  items: ArtworkItem[];
  cache: "fresh" | "stale";
  hasMore: boolean;
}

export interface SelectedArtwork {
  url: string;
  artworkId: number;
}

export interface GameArtworkSelection {
  objectId: string;
  shop: GameShop;
  selected: Partial<Record<ArtworkAssetType, SelectedArtwork>>;
  updatedAt: number;
}
