import type { LibraryGame } from "@types";
import { GridFocusGroup } from "../../../common";
import {
  getLibraryFocusListItemId,
  LIBRARY_FOCUS_LIST_REGION_ID,
} from "../navigation";
import { useLibraryListNavigation } from "../list-navigation";
import { HorizontalLibraryGameListCard } from "../game-card";

import "./focus-list.scss";

export interface LibraryFocusListProps {
  games: LibraryGame[];
}

export function LibraryFocusList({ games }: Readonly<LibraryFocusListProps>) {
  const navigationOverridesByItemId = useLibraryListNavigation(games);

  if (games.length === 0) return null;

  return (
    <section className="library-focus-list">
      <GridFocusGroup
        className="library-focus-list__grid"
        regionId={LIBRARY_FOCUS_LIST_REGION_ID}
      >
        {games.map((game) => (
          <HorizontalLibraryGameListCard
            key={game.id}
            game={game}
            navigationOverrides={
              navigationOverridesByItemId[getLibraryFocusListItemId(game.id)]
            }
          />
        ))}
      </GridFocusGroup>
    </section>
  );
}
