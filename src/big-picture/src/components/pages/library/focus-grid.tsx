import type { LibraryGame } from "@types";
import { GridFocusGroup } from "../../common";
import {
  getLibraryFocusGridItemId,
  LIBRARY_FOCUS_GRID_REGION_ID,
} from "./navigation";
import { useLibraryGridNavigation } from "./use-library-grid-navigation";
import { VerticalLibraryGameCard } from "./vertical-library-game-card";

import "./focus-grid.scss";

export interface LibraryFocusGridProps {
  games: LibraryGame[];
}

export function LibraryFocusGrid({ games }: Readonly<LibraryFocusGridProps>) {
  const navigationOverridesByItemId = useLibraryGridNavigation(games);

  if (games.length === 0) return null;

  return (
    <section className="library-focus-grid">
      <GridFocusGroup
        className="library-focus-grid__grid"
        regionId={LIBRARY_FOCUS_GRID_REGION_ID}
      >
        {games.map((game) => (
          <VerticalLibraryGameCard
            key={game.id}
            game={game}
            navigationOverrides={
              navigationOverridesByItemId[getLibraryFocusGridItemId(game.id)]
            }
          />
        ))}
      </GridFocusGroup>
    </section>
  );
}
