import { memo, useEffect, useMemo, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  buildCoverThumbnailUrl,
  COVER_THUMBNAIL_SCHEME,
  pickCoverThumbnailWidth,
} from "@shared";
import type { LibraryGame } from "@types";
import { resolveImageSource } from "@renderer/helpers";
import { LibraryGameCard } from "./library-game-card";
import { LibraryGameCardLarge } from "./library-game-card-large";
import type { ViewMode } from "./view-options";

const MAX_PREFETCHED_COVERS = 1000;
const LARGE_CARD_LOGO_MAX_WIDTH = 400;

const orderAroundIndex = <T,>(items: T[], anchorIndex: number): T[] => {
  const anchor = Math.min(Math.max(anchorIndex, 0), items.length);
  const ordered: T[] = [];

  const maxOffset = Math.max(anchor, items.length - anchor);
  for (let offset = 0; offset < maxOffset; offset++) {
    const after = anchor + offset;
    if (after < items.length) ordered.push(items[after]);

    const before = anchor - offset - 1;
    if (before >= 0) ordered.push(items[before]);
  }

  return ordered;
};

const getPrimaryArtworkSource = (game: LibraryGame, mode: ViewMode) => {
  const candidates =
    mode === "large"
      ? [
          game.customHeroImageUrl,
          game.libraryHeroImageUrl,
          ...(game.shop === "launchbox"
            ? []
            : [game.customCoverImageUrl, game.coverImageUrl]),
          game.libraryImageUrl,
          game.iconUrl,
        ]
      : [
          game.customCoverImageUrl,
          game.coverImageUrl,
          game.libraryImageUrl,
          game.iconUrl,
        ];

  const source = candidates.find((url) => url && url.trim() !== "");
  if (!source) return "";

  return mode === "large"
    ? source.replaceAll("\\", "/")
    : resolveImageSource(source);
};

type LibraryGameContextMenuHandler = (
  game: LibraryGame,
  position: { x: number; y: number }
) => void;

interface LibraryGamesRowProps {
  games: LibraryGame[];
  start: number;
  columnsCount: number;
  gap: number;
  viewMode: ViewMode;
  thumbnailWidth: number;
  logoThumbnailWidth: number;
  onContextMenu: LibraryGameContextMenuHandler;
}

const LibraryGamesRow = memo(function LibraryGamesRow({
  games,
  start,
  columnsCount,
  gap,
  viewMode,
  thumbnailWidth,
  logoThumbnailWidth,
  onContextMenu,
}: Readonly<LibraryGamesRowProps>) {
  return (
    <div
      className={`library__games-row library__games-row--${viewMode}`}
      style={{
        right: gap,
        transform: `translateY(${start}px)`,
        gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
        gap: `${gap}px`,
      }}
    >
      {games.map((game) =>
        viewMode === "large" ? (
          <LibraryGameCardLarge
            key={`${game.shop}-${game.objectId}`}
            game={game}
            onContextMenu={onContextMenu}
            thumbnailWidth={thumbnailWidth}
            logoThumbnailWidth={logoThumbnailWidth}
          />
        ) : (
          <LibraryGameCard
            key={`${game.shop}-${game.objectId}`}
            game={game}
            onContextMenu={onContextMenu}
            thumbnailWidth={thumbnailWidth}
          />
        )
      )}
    </div>
  );
});

interface LibraryGamesGridProps {
  games: LibraryGame[];
  viewMode: ViewMode;
  columnsCount: number;
  itemWidth: number;
  estimatedRowHeight: number;
  gap: number;
  scrollElementRef: RefObject<HTMLDivElement>;
  getInitialScrollOffset: () => number;
  onContextMenu: LibraryGameContextMenuHandler;
  isScrollbarDragging: boolean;
}

export const LibraryGamesGrid = memo(function LibraryGamesGrid({
  games,
  viewMode,
  columnsCount,
  itemWidth,
  estimatedRowHeight,
  gap,
  scrollElementRef,
  getInitialScrollOffset,
  onContextMenu,
  isScrollbarDragging,
}: Readonly<LibraryGamesGridProps>) {
  const rows = useMemo(() => {
    const result: LibraryGame[][] = [];
    for (let i = 0; i < games.length; i += columnsCount) {
      result.push(games.slice(i, i + columnsCount));
    }
    return result;
  }, [games, columnsCount]);

  const devicePixelRatio = window.devicePixelRatio || 1;
  const thumbnailWidth = pickCoverThumbnailWidth(itemWidth * devicePixelRatio);
  const logoThumbnailWidth = pickCoverThumbnailWidth(
    Math.min(LARGE_CARD_LOGO_MAX_WIDTH, itemWidth) * devicePixelRatio
  );

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimatedRowHeight,
    initialOffset: getInitialScrollOffset,
    overscan: 2,
    isScrollingResetDelay: 80,
    useFlushSync: false,
  });

  const isScrolling = rowVirtualizer.isScrolling;
  const firstVisibleRow = rowVirtualizer.range?.startIndex ?? 0;
  const [prefetchAnchorRow, setPrefetchAnchorRow] = useState(0);

  useEffect(() => {
    if (!isScrolling) setPrefetchAnchorRow(firstVisibleRow);
  }, [isScrolling, firstVisibleRow]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, estimatedRowHeight]);

  useEffect(() => {
    if (games.length === 0) return;

    const prefetch = () => {
      const thumbnailUrls = orderAroundIndex(
        games,
        prefetchAnchorRow * columnsCount
      )
        .slice(0, MAX_PREFETCHED_COVERS)
        .flatMap((game) => {
          const artworkUrl = buildCoverThumbnailUrl(
            getPrimaryArtworkSource(game, viewMode),
            thumbnailWidth
          );
          if (viewMode !== "large") return [artworkUrl];

          const logo = game.customLogoImageUrl ?? game.logoImageUrl;
          return logo
            ? [
                artworkUrl,
                buildCoverThumbnailUrl(
                  logo.replaceAll("\\", "/"),
                  logoThumbnailWidth
                ),
              ]
            : [artworkUrl];
        })
        .filter((thumbnailUrl) =>
          thumbnailUrl.startsWith(`${COVER_THUMBNAIL_SCHEME}:`)
        );

      void window.electron.prefetchCoverThumbnails(thumbnailUrls);
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(prefetch, { timeout: 2000 });
      return () => window.cancelIdleCallback(handle);
    }

    const handle = window.setTimeout(prefetch, 500);
    return () => window.clearTimeout(handle);
  }, [
    games,
    thumbnailWidth,
    logoThumbnailWidth,
    viewMode,
    prefetchAnchorRow,
    columnsCount,
  ]);

  const placeholderStyle = useMemo(() => {
    const tileWidth =
      (itemWidth * columnsCount + gap * (columnsCount - 1)) / columnsCount;
    const cardWidth = tileWidth - gap;
    const cardHeight =
      viewMode === "large" ? estimatedRowHeight - gap : (cardWidth * 3) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${estimatedRowHeight}"><rect width="${cardWidth}" height="${cardHeight}" rx="${viewMode === "large" ? 8 : 4}" fill="#1c1c1c"/></svg>`;

    return {
      backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
      backgroundSize: `${tileWidth}px ${estimatedRowHeight}px`,
    };
  }, [itemWidth, gap, columnsCount, estimatedRowHeight, viewMode]);

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      className={`library__games-grid-virtual${isScrolling ? " library__games-grid-virtual--scrolling" : ""}`}
      style={{
        height: `${rowVirtualizer.getTotalSize()}px`,
        ...(isScrollbarDragging ? placeholderStyle : null),
      }}
    >
      {virtualRows.map((virtualRow) =>
        rows[virtualRow.index] ? (
          <LibraryGamesRow
            key={virtualRow.key}
            games={rows[virtualRow.index]}
            start={virtualRow.start}
            columnsCount={columnsCount}
            gap={gap}
            viewMode={viewMode}
            thumbnailWidth={thumbnailWidth}
            logoThumbnailWidth={logoThumbnailWidth}
            onContextMenu={onContextMenu}
          />
        ) : null
      )}
    </div>
  );
});
