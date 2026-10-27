import type { LibraryGame } from "@types";
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
} from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { GridFocusGroup } from "../../common";
import type { FocusOverrides } from "../../../services";
import { useNavigationStore } from "../../../stores";
import { getRememberedFocusId } from "../../../hooks/use-remembered-focus.hook";
import { LIBRARY_FILTERS_TOOLBAR_REGION_ID } from "./navigation";

const ROW_OVERSCAN = 2;
const lastMeasuredRowHeightByRegion = new Map<string, number>();

export type LibraryVirtualGridItemRenderer = (
  game: LibraryGame,
  navigationOverrides: FocusOverrides
) => ReactNode;

export interface LibraryVirtualFocusGridProps {
  games: LibraryGame[];
  columnCount: number;
  regionId: string;
  className: string;
  rowClassName: string;
  style?: CSSProperties;
  estimatedRowHeight: number;
  scrollElementRef: RefObject<HTMLElement>;
  getInitialScrollOffset?: () => number;
  getItemId: (gameId: string) => string;
  renderItem: LibraryVirtualGridItemRenderer;
}

function getNavigationOverrides(
  index: number,
  columnCount: number,
  games: LibraryGame[],
  getItemId: (gameId: string) => string
): FocusOverrides {
  const itemCount = games.length;
  const column = index % columnCount;
  const rowStart = index - column;
  const lastRowStart = itemCount - 1 - ((itemCount - 1) % columnCount);
  const itemTarget = (targetIndex: number) => ({
    type: "item" as const,
    itemId: getItemId(games[targetIndex].id),
  });

  return {
    ...(column > 0 ? { left: itemTarget(index - 1) } : {}),
    right:
      column < columnCount - 1 && index + 1 < itemCount
        ? itemTarget(index + 1)
        : { type: "block" },
    up:
      index >= columnCount
        ? itemTarget(index - columnCount)
        : {
            type: "region",
            regionId: LIBRARY_FILTERS_TOOLBAR_REGION_ID,
            entryDirection: "down",
          },
    down:
      rowStart < lastRowStart
        ? itemTarget(Math.min(index + columnCount, itemCount - 1))
        : { type: "block" },
  };
}

interface LibraryVirtualGridRowProps {
  games: LibraryGame[];
  rowIndex: number;
  columnCount: number;
  start: number;
  className: string;
  getItemId: (gameId: string) => string;
  renderItem: LibraryVirtualGridItemRenderer;
  measureElement: (element: HTMLElement | null) => void;
}

const LibraryVirtualGridRow = memo(function LibraryVirtualGridRow({
  games,
  rowIndex,
  columnCount,
  start,
  className,
  getItemId,
  renderItem,
  measureElement,
}: Readonly<LibraryVirtualGridRowProps>) {
  const firstIndex = rowIndex * columnCount;
  const rowGames = games.slice(firstIndex, firstIndex + columnCount);
  const rowLength = rowGames.length;
  const navigationOverrides = useMemo(
    () =>
      Array.from({ length: rowLength }, (_, offset) =>
        getNavigationOverrides(
          firstIndex + offset,
          columnCount,
          games,
          getItemId
        )
      ),
    [columnCount, firstIndex, games, getItemId, rowLength]
  );

  return (
    <div
      ref={measureElement}
      data-index={rowIndex}
      className={className}
      style={{ transform: `translateY(${start}px)` }}
    >
      {rowGames.map((game, offset) =>
        renderItem(game, navigationOverrides[offset])
      )}
    </div>
  );
});

export function LibraryVirtualFocusGrid({
  games,
  columnCount,
  regionId,
  className,
  rowClassName,
  style,
  estimatedRowHeight,
  scrollElementRef,
  getInitialScrollOffset,
  getItemId,
  renderItem,
}: Readonly<LibraryVirtualFocusGridProps>) {
  const { pathname } = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const rowCount = Math.ceil(games.length / columnCount);

  const indexByItemId = useMemo(
    () => new Map(games.map((game, index) => [getItemId(game.id), index])),
    [games, getItemId]
  );
  const focusedItemId = useNavigationStore((state) =>
    state.currentFocusId && indexByItemId.has(state.currentFocusId)
      ? state.currentFocusId
      : null
  );
  const [rememberedItemId] = useState(() => getRememberedFocusId(pathname));

  const pinnedRowIndexes = useMemo(
    () =>
      [focusedItemId, rememberedItemId]
        .map((itemId) => (itemId ? indexByItemId.get(itemId) : undefined))
        .filter((index): index is number => index !== undefined)
        .map((index) => Math.floor(index / columnCount)),
    [columnCount, focusedItemId, indexByItemId, rememberedItemId]
  );

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      for (const rowIndex of pinnedRowIndexes) {
        if (rowIndex < range.count && !indexes.includes(rowIndex)) {
          indexes.push(rowIndex);
        }
      }
      return indexes.sort((left, right) => left - right);
    },
    [pinnedRowIndexes]
  );

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () =>
      lastMeasuredRowHeightByRegion.get(regionId) ?? estimatedRowHeight,
    initialOffset: getInitialScrollOffset,
    overscan: ROW_OVERSCAN,
    scrollMargin,
    rangeExtractor,
    useFlushSync: false,
  });

  const measureElement = useCallback(
    (element: HTMLElement | null) => {
      virtualizer.measureElement(element);
      const height = element?.getBoundingClientRect().height;
      if (height) lastMeasuredRowHeightByRegion.set(regionId, height);
    },
    [regionId, virtualizer]
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const scrollElement = scrollElementRef.current;
    if (!container || !scrollElement) return;

    const updateScrollMargin = () => {
      setScrollMargin(
        Math.round(
          container.getBoundingClientRect().top -
            scrollElement.getBoundingClientRect().top +
            scrollElement.scrollTop
        )
      );
    };

    updateScrollMargin();

    const resizeObserver = new ResizeObserver(updateScrollMargin);
    if (scrollElement.firstElementChild) {
      resizeObserver.observe(scrollElement.firstElementChild);
    }

    return () => resizeObserver.disconnect();
  }, [scrollElementRef]);

  if (games.length === 0) return null;

  return (
    <div ref={containerRef}>
      <GridFocusGroup
        className={className}
        regionId={regionId}
        style={{
          ...style,
          position: "relative",
          height: virtualizer.getTotalSize(),
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <LibraryVirtualGridRow
            key={virtualRow.key}
            games={games}
            rowIndex={virtualRow.index}
            columnCount={columnCount}
            start={virtualRow.start - scrollMargin}
            className={rowClassName}
            getItemId={getItemId}
            renderItem={renderItem}
            measureElement={measureElement}
          />
        ))}
      </GridFocusGroup>
    </div>
  );
}
