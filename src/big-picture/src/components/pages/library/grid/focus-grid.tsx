import { useRef } from "react";
import type { RefObject } from "react";

import type { LibraryGame } from "@types";
import { GridFocusGroup } from "../../../common";
import {
  getLibraryFocusGridItemId,
  LIBRARY_FOCUS_GRID_REGION_ID,
} from "../navigation";
import { useLibraryGridLayout } from "./use-library-grid-layout";
import { VerticalLibraryGameCard } from "../game-card";
import { useLibraryVirtualNavigation } from "../use-library-virtual-navigation";
import { LibraryVirtualRow } from "../virtual-row";

import "./focus-grid.scss";

const GRID_ROW_GAP = 64;
const GRID_COVER_ASPECT = 400 / 268;
const GRID_CARD_BODY_HEIGHT = 81.5;

export interface LibraryFocusGridProps {
  games: LibraryGame[];
  scrollElementRef: RefObject<HTMLElement | null>;
  contextMenuGameId?: string | null;
  onOpenContextMenu?: (
    game: LibraryGame,
    position: { x: number; y: number },
    restoreFocusId: string
  ) => void;
}

export function LibraryFocusGrid({
  games,
  scrollElementRef,
  contextMenuGameId = null,
  onOpenContextMenu,
}: Readonly<LibraryFocusGridProps>) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const { columnCount, columnGap, width } = useLibraryGridLayout(games.length);
  const cardWidth =
    width > 0 ? (width - columnGap * (columnCount - 1)) / columnCount : 150;
  const estimatedRowHeight = Math.round(
    cardWidth * GRID_COVER_ASPECT + GRID_CARD_BODY_HEIGHT
  );
  const { navigationModel, virtualizer, virtualRows, scrollMargin } =
    useLibraryVirtualNavigation({
      games,
      columnCount,
      getItemId: getLibraryFocusGridItemId,
      scrollElementRef,
      anchorRef: sectionRef,
      estimateRowHeight: estimatedRowHeight,
      rowGap: GRID_ROW_GAP,
    });

  if (games.length === 0) return null;

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
    columnGap: `${columnGap}px`,
  };

  return (
    <section ref={sectionRef} className="library-focus-grid">
      <GridFocusGroup
        className="library-focus-grid__virtual"
        regionId={LIBRARY_FOCUS_GRID_REGION_ID}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualRows.map((virtualRow) => (
          <LibraryVirtualRow
            key={virtualRow.key}
            virtualRow={virtualRow}
            scrollMargin={scrollMargin}
            measureElement={virtualizer.measureElement}
            className="library-focus-grid__row"
            style={gridStyle}
          >
            {navigationModel.rows[virtualRow.index].map((game) => (
              <VerticalLibraryGameCard
                key={game.id}
                game={game}
                contextMenuOpen={contextMenuGameId === game.id}
                onOpenContextMenu={onOpenContextMenu}
                navigationOverrides={
                  navigationModel.overridesByItemId[
                    getLibraryFocusGridItemId(game.id)
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
