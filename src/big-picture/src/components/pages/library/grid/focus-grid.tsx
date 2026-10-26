import type { LibraryGame } from "@types";
import { type RefObject, useCallback } from "react";
import {
  getLibraryFocusGridItemId,
  LIBRARY_FOCUS_GRID_REGION_ID,
} from "../navigation";
import { useLibraryGridLayout } from "./use-library-grid-layout";
import { VerticalLibraryGameCard } from "../game-card";
import {
  LibraryVirtualFocusGrid,
  type LibraryVirtualGridItemRenderer,
} from "../virtual-focus-grid";

import "./focus-grid.scss";

export interface LibraryFocusGridProps {
  games: LibraryGame[];
  scrollElementRef: RefObject<HTMLElement>;
  getInitialScrollOffset?: () => number;
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
  getInitialScrollOffset,
  contextMenuGameId = null,
  onOpenContextMenu,
}: Readonly<LibraryFocusGridProps>) {
  const { style, columnCount, estimatedRowHeight } = useLibraryGridLayout(
    games.length
  );

  const renderItem = useCallback<LibraryVirtualGridItemRenderer>(
    (game, navigationOverrides) => (
      <VerticalLibraryGameCard
        key={game.id}
        game={game}
        contextMenuOpen={contextMenuGameId === game.id}
        onOpenContextMenu={onOpenContextMenu}
        navigationOverrides={navigationOverrides}
      />
    ),
    [contextMenuGameId, onOpenContextMenu]
  );

  if (games.length === 0) return null;

  return (
    <section className="library-focus-grid">
      <LibraryVirtualFocusGrid
        games={games}
        columnCount={columnCount}
        regionId={LIBRARY_FOCUS_GRID_REGION_ID}
        className="library-focus-grid__grid"
        rowClassName="library-focus-grid__row"
        style={style}
        estimatedRowHeight={estimatedRowHeight}
        scrollElementRef={scrollElementRef}
        getInitialScrollOffset={getInitialScrollOffset}
        getItemId={getLibraryFocusGridItemId}
        renderItem={renderItem}
      />
    </section>
  );
}
