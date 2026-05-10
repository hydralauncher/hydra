import type { LibraryGame } from "@types";
import { GridFocusGroup } from "../../../common";
import {
  getLibraryFocusGridItemId,
  LIBRARY_FOCUS_GRID_REGION_ID,
} from "../navigation";
import { useLibraryGridNavigation } from "../grid-navigation";
import { useLibraryGridLayout } from "./use-library-grid-layout";
import { VerticalLibraryGameCard } from "../game-card";

import "./focus-grid.scss";

export interface LibraryFocusGridProps {
  games: LibraryGame[];
  contextMenuGameId?: string | null;
  onOpenContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

export function LibraryFocusGrid({
  games,
  contextMenuGameId = null,
  onOpenContextMenu,
}: Readonly<LibraryFocusGridProps>) {
  const navigationOverridesByItemId = useLibraryGridNavigation(games);
  const style = useLibraryGridLayout(games.length);

  if (games.length === 0) return null;

  return (
    <section className="library-focus-grid">
      <GridFocusGroup
        className="library-focus-grid__grid"
        regionId={LIBRARY_FOCUS_GRID_REGION_ID}
        style={style}
      >
        {games.map((game) => (
          <VerticalLibraryGameCard
            key={game.id}
            game={game}
            contextMenuOpen={contextMenuGameId === game.id}
            onOpenContextMenu={onOpenContextMenu}
            navigationOverrides={
              navigationOverridesByItemId[getLibraryFocusGridItemId(game.id)]
            }
          />
        ))}
      </GridFocusGroup>
    </section>
  );
}
