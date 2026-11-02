import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { UserGame } from "@types";

const GRID_GAP = 16;
const COVER_ASPECT_RATIO = 3 / 2;
const UNMEASURED_ROW_HEIGHT = 300;
const ROW_OVERSCAN = 2;

// Mirrors the container queries on .profile-content__games-grid.
const GRID_COLUMNS_BY_CONTAINER_WIDTH = [
  [3000, 12],
  [2600, 8],
  [2000, 6],
  [1300, 5],
  [900, 4],
] as const;

export const getProfileGridColumns = (containerWidth: number) =>
  GRID_COLUMNS_BY_CONTAINER_WIDTH.find(
    ([minWidth]) => containerWidth >= minWidth
  )?.[1] ?? 2;

interface ProfileLibraryGridProps {
  games: UserGame[];
  scrollContainerId: string;
  getKey: (game: UserGame) => string;
  renderGame: (game: UserGame) => ReactNode;
}

export function ProfileLibraryGrid({
  games,
  scrollContainerId,
  getKey,
  renderGame,
}: Readonly<ProfileLibraryGridProps>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollElement] = useState(() =>
    document.getElementById(scrollContainerId)
  );
  const [layout, setLayout] = useState({
    columns: 2,
    listWidth: 0,
    scrollMargin: 0,
  });

  useLayoutEffect(() => {
    const list = listRef.current;
    const queryContainer = scrollElement?.parentElement;
    if (!list || !scrollElement || !queryContainer) return;

    const measure = () => {
      const columns = getProfileGridColumns(queryContainer.clientWidth);
      const listWidth = list.clientWidth;
      const scrollMargin = Math.round(
        list.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top +
          scrollElement.scrollTop
      );
      setLayout((previous) =>
        previous.columns === columns &&
        previous.listWidth === listWidth &&
        previous.scrollMargin === scrollMargin
          ? previous
          : { columns, listWidth, scrollMargin }
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(queryContainer);
    if (scrollElement.firstElementChild) {
      observer.observe(scrollElement.firstElementChild);
    }
    return () => observer.disconnect();
  }, [scrollElement]);

  const { columns, listWidth, scrollMargin } = layout;

  const rows = useMemo(() => {
    const result: UserGame[][] = [];
    for (let index = 0; index < games.length; index += columns) {
      result.push(games.slice(index, index + columns));
    }
    return result;
  }, [games, columns]);

  const estimatedRowHeight =
    listWidth > 0
      ? Math.round(
          ((listWidth - GRID_GAP * (columns - 1)) / columns) *
            COVER_ASPECT_RATIO
        ) + GRID_GAP
      : UNMEASURED_ROW_HEIGHT;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => estimatedRowHeight,
    overscan: ROW_OVERSCAN,
    scrollMargin,
  });

  return (
    <div
      ref={listRef}
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((row) => (
        <ul
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="profile-content__games-grid"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            paddingBottom: GRID_GAP,
            transform: `translateY(${row.start - scrollMargin}px)`,
          }}
        >
          {rows[row.index].map((game) => (
            <li key={getKey(game)} style={{ listStyle: "none" }}>
              {renderGame(game)}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
