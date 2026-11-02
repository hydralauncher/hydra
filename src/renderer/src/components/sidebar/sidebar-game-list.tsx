import { memo, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LibraryGame } from "@types";
import { SidebarGameItem } from "./sidebar-game-item";
import { SidebarGameListSkeleton } from "./sidebar-game-list-skeleton";

const SIDEBAR_GAME_ITEM_HEIGHT = 42;
const SIDEBAR_GAME_LIST_OVERSCAN = 5;
const SIDEBAR_GAME_LIST_RIGHT_GUTTER = 16;

interface SidebarGameListProps {
  games: LibraryGame[];
  isLoading: boolean;
  hasActiveFilter: boolean;
  emptyLabel: string;
  onGameClick: (game: LibraryGame) => void;
  getGameTitle: (game: LibraryGame) => string;
}

// Owns the virtualizer so scrolling re-renders only the list, not the whole sidebar.
export const SidebarGameList = memo(function SidebarGameList({
  games,
  isLoading,
  hasActiveFilter,
  emptyLabel,
  onGameClick,
  getGameTitle,
}: Readonly<SidebarGameListProps>) {
  const gameListRef = useRef<HTMLDivElement>(null);
  const [isGameListScrolled, setIsGameListScrolled] = useState(false);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);

  const virtualizer = useVirtualizer({
    count: games.length,
    getScrollElement: () => gameListRef.current,
    estimateSize: () => SIDEBAR_GAME_ITEM_HEIGHT,
    overscan: SIDEBAR_GAME_LIST_OVERSCAN,
  });

  useEffect(() => {
    const el = gameListRef.current;
    if (!el) return;
    const measure = () => setScrollbarWidth(el.offsetWidth - el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`sidebar__game-list${isGameListScrolled ? " sidebar__game-list--scrolled" : ""}`}
    >
      <div
        ref={gameListRef}
        className="sidebar__game-list-scroll"
        onScroll={(e) =>
          setIsGameListScrolled((e.currentTarget as HTMLElement).scrollTop > 0)
        }
      >
        {isLoading && <SidebarGameListSkeleton />}

        {!isLoading && hasActiveFilter && games.length === 0 && (
          <p className="sidebar__game-list-empty">{emptyLabel}</p>
        )}

        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const game = games[virtualItem.index];
            return (
              <div
                key={game.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: SIDEBAR_GAME_LIST_RIGHT_GUTTER - scrollbarWidth,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <SidebarGameItem
                  game={game}
                  handleSidebarGameClick={onGameClick}
                  getGameTitle={getGameTitle}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
