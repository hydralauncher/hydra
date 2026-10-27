import type { LibraryGame } from "@types";
import { type RefObject, useCallback, useEffect, useState } from "react";
import {
  getLibraryFocusListItemId,
  LIBRARY_FOCUS_LIST_REGION_ID,
} from "../navigation";
import { HorizontalLibraryGameListCard } from "../game-card";
import {
  LibraryVirtualFocusGrid,
  type LibraryVirtualGridItemRenderer,
} from "../virtual-focus-grid";

import "./focus-list.scss";

const LIST_THREE_COLUMNS_MIN_WIDTH = 1281;
const LIST_FOUR_COLUMNS_MIN_WIDTH = 2240;
const LIST_ESTIMATED_ROW_HEIGHT = 200;

function getListColumnCount() {
  const viewportWidth = globalThis.innerWidth;
  if (viewportWidth >= LIST_FOUR_COLUMNS_MIN_WIDTH) return 4;
  if (viewportWidth >= LIST_THREE_COLUMNS_MIN_WIDTH) return 3;
  return 2;
}

export interface LibraryFocusListProps {
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

export function LibraryFocusList({
  games,
  scrollElementRef,
  getInitialScrollOffset,
  contextMenuGameId = null,
  onOpenContextMenu,
}: Readonly<LibraryFocusListProps>) {
  const [columnCount, setColumnCount] = useState(getListColumnCount);

  useEffect(() => {
    const handleResize = () => setColumnCount(getListColumnCount());
    globalThis.addEventListener("resize", handleResize);
    return () => globalThis.removeEventListener("resize", handleResize);
  }, []);

  const renderItem = useCallback<LibraryVirtualGridItemRenderer>(
    (game, navigationOverrides) => (
      <HorizontalLibraryGameListCard
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
    <section className="library-focus-list">
      <LibraryVirtualFocusGrid
        games={games}
        columnCount={columnCount}
        regionId={LIBRARY_FOCUS_LIST_REGION_ID}
        className="library-focus-list__grid"
        rowClassName="library-focus-list__row"
        estimatedRowHeight={LIST_ESTIMATED_ROW_HEIGHT}
        scrollElementRef={scrollElementRef}
        getInitialScrollOffset={getInitialScrollOffset}
        getItemId={getLibraryFocusListItemId}
        renderItem={renderItem}
      />
    </section>
  );
}
