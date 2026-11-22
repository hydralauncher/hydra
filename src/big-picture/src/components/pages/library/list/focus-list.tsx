import type { LibraryGame } from "@types";
import { GridFocusGroup } from "../../../common";
import {
  getLibraryFocusListItemId,
  LIBRARY_FOCUS_LIST_REGION_ID,
} from "../navigation";
import { useLibraryListNavigation } from "../list-navigation";
import { HorizontalLibraryGameListCard } from "../game-card";
import type { LibraryCardSize } from "../library-card-size";

import "./focus-list.scss";

export interface LibraryFocusListProps {
  games: LibraryGame[];
  cardSize: LibraryCardSize;
  contextMenuGameId?: string | null;
  onOpenContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

export function LibraryFocusList({
  games,
  cardSize,
  contextMenuGameId = null,
  onOpenContextMenu,
}: Readonly<LibraryFocusListProps>) {
  const navigationOverridesByItemId = useLibraryListNavigation(games);

  if (games.length === 0) return null;

  return (
    <section className="library-focus-list" data-card-size={cardSize}>
      <GridFocusGroup
        className="library-focus-list__grid"
        regionId={LIBRARY_FOCUS_LIST_REGION_ID}
      >
        {games.map((game) => (
          <HorizontalLibraryGameListCard
            key={game.id}
            game={game}
            contextMenuOpen={contextMenuGameId === game.id}
            onOpenContextMenu={onOpenContextMenu}
            navigationOverrides={
              navigationOverridesByItemId[getLibraryFocusListItemId(game.id)]
            }
          />
        ))}
      </GridFocusGroup>
    </section>
  );
}
