import { useRef } from "react";
import type { RefObject } from "react";

import type { LibraryGame } from "@types";
import { GridFocusGroup } from "../../../common";
import {
  getLibraryFocusListItemId,
  LIBRARY_FOCUS_LIST_REGION_ID,
} from "../navigation";
import { useLibraryListLayout } from "./use-library-list-layout";
import { HorizontalLibraryGameListCard } from "../game-card";
import { useLibraryVirtualNavigation } from "../use-library-virtual-navigation";
import { LibraryVirtualRow } from "../virtual-row";

import "./focus-list.scss";

const LIST_ROW_GAP = 32;
const LIST_COVER_ASPECT = 215 / 460;
const LIST_CARD_BODY_HEIGHT = 91;
const LIST_FALLBACK_CARD_WIDTH = 300;

export interface LibraryFocusListProps {
  games: LibraryGame[];
  scrollElementRef: RefObject<HTMLElement | null>;
  contextMenuGameId?: string | null;
  onOpenContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

export function LibraryFocusList({
  games,
  scrollElementRef,
  contextMenuGameId = null,
  onOpenContextMenu,
}: Readonly<LibraryFocusListProps>) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const { columnCount, columnGap, width } = useLibraryListLayout(games.length);
  const cardWidth =
    width > 0
      ? (width - columnGap * (columnCount - 1)) / columnCount
      : LIST_FALLBACK_CARD_WIDTH;
  const estimatedRowHeight = Math.round(
    cardWidth * LIST_COVER_ASPECT + LIST_CARD_BODY_HEIGHT
  );
  const { navigationModel, virtualizer, virtualRows, scrollMargin } =
    useLibraryVirtualNavigation({
      games,
      columnCount,
      getItemId: getLibraryFocusListItemId,
      scrollElementRef,
      anchorRef: sectionRef,
      estimateRowHeight: estimatedRowHeight,
      rowGap: LIST_ROW_GAP,
    });

  if (games.length === 0) return null;

  return (
    <section ref={sectionRef} className="library-focus-list">
      <GridFocusGroup
        className="library-focus-list__virtual"
        regionId={LIBRARY_FOCUS_LIST_REGION_ID}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((virtualRow) => (
          <LibraryVirtualRow
            key={virtualRow.key}
            virtualRow={virtualRow}
            scrollMargin={scrollMargin}
            measureElement={virtualizer.measureElement}
            className="library-focus-list__row"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
              columnGap: `${columnGap}px`,
            }}
          >
            {navigationModel.rows[virtualRow.index].map((game) => (
              <HorizontalLibraryGameListCard
                key={game.id}
                game={game}
                contextMenuOpen={contextMenuGameId === game.id}
                onOpenContextMenu={onOpenContextMenu}
                navigationOverrides={
                  navigationModel.overridesByItemId[
                    getLibraryFocusListItemId(game.id)
                  ]
                }
              />
            ))}
          </LibraryVirtualRow>
        ))}
      </GridFocusGroup>
    </section>
  );
}
