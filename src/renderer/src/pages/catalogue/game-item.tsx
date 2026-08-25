import type { CatalogueSearchResult } from "@types";
import { CatalogueCard } from "./catalogue-section";

export interface GameItemProps {
  game: CatalogueSearchResult;
}

export function GameItem({ game }: Readonly<GameItemProps>) {
  return <CatalogueCard game={game} />;
}
