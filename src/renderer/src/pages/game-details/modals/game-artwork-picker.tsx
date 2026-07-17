import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Button } from "@renderer/components";
import {
  getArtworkDisplaySource,
  getLastArtworkRowIds,
  getRenderableArtworkUrl,
  isAnimatedArtworkItem,
  isArtworkRowSettled,
  useGameArtworkGrid,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import type { ArtworkAssetType, ArtworkItem, LibraryGame } from "@types";

import "./game-artwork-picker.scss";

const GAP = 8;

const GRID_CONFIG: Record<
  ArtworkAssetType,
  { minColumnWidth: number; aspectRatio: number; maxColumns?: number }
> = {
  icon: { minColumnWidth: 72, aspectRatio: 1 },
  grid: { minColumnWidth: 110, aspectRatio: 1.5, maxColumns: 4 },
  hero: { minColumnWidth: 220, aspectRatio: 0.3229 },
  logo: { minColumnWidth: 140, aspectRatio: 0.5625 },
};

const INITIAL_SKELETON_COUNT: Record<ArtworkAssetType, number> = {
  icon: 28,
  grid: 12,
  hero: 8,
  logo: 12,
};
const MORE_SKELETON_COUNT = 4;

interface ArtworkTileProps {
  item: ArtworkItem;
  assetType: ArtworkAssetType;
  isActive: boolean;
  isBusy: boolean;
  isPending: boolean;
  isMediaSettled: boolean;
  onPick: (item: ArtworkItem) => Promise<void>;
  onMediaSettled: (artworkId: number) => void;
}

function ArtworkTile({
  item,
  assetType,
  isActive,
  isBusy,
  isPending,
  isMediaSettled,
  onPick,
  onMediaSettled,
}: Readonly<ArtworkTileProps>) {
  const display = getArtworkDisplaySource(item);
  const [hasMediaFailed, setHasMediaFailed] = useState(false);

  const handleMediaLoaded = () => {
    onMediaSettled(item.id);
  };

  const handleMediaError = () => {
    setHasMediaFailed(true);
    onMediaSettled(item.id);
  };

  let media: React.ReactNode = null;

  if (!hasMediaFailed) {
    media = display.isVideo ? (
      <video
        className={isMediaSettled ? "game-artwork__media--loaded" : ""}
        src={display.src}
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        preload="auto"
        onLoadedData={handleMediaLoaded}
        onError={handleMediaError}
      />
    ) : (
      <img
        className={isMediaSettled ? "game-artwork__media--loaded" : ""}
        src={display.src}
        alt=""
        loading="eager"
        decoding="async"
        onLoad={handleMediaLoaded}
        onError={handleMediaError}
      />
    );
  }

  return (
    <button
      type="button"
      className={`game-artwork__item game-artwork__item--${assetType} ${
        isActive ? "game-artwork__item--active" : ""
      }`}
      onClick={() => {
        onPick(item).catch(() => {});
      }}
      disabled={isBusy || !isMediaSettled || hasMediaFailed}
    >
      {media}
      {!isMediaSettled && (
        <Skeleton
          containerClassName="game-artwork__skeleton"
          height="100%"
          width="100%"
        />
      )}
      {isPending && (
        <span className="game-artwork__item-spinner" aria-hidden="true" />
      )}
    </button>
  );
}

interface GameArtworkPickerProps {
  game: LibraryGame;
  assetType: ArtworkAssetType;
  onChanged: () => Promise<void> | void;
  onSelectArtwork: (artwork: {
    artworkUrl: string;
    artworkId: number;
  }) => Promise<boolean>;
  selectionVersion?: number;
  disabled?: boolean;
}

export function GameArtworkPicker({
  game,
  assetType,
  onChanged,
  onSelectArtwork,
  selectionVersion = 0,
  disabled = false,
}: Readonly<GameArtworkPickerProps>) {
  const { t } = useTranslation("sidebar");
  const { t: tProfile } = useTranslation("user_profile");
  const { showErrorToast, showSuccessToast } = useToast();
  const { userDetails } = useUserDetails();

  const onError = useCallback(() => {
    showErrorToast(t("steamgriddb_fetch_failed"));
  }, [showErrorToast, t]);

  const onPicked = useCallback(() => {
    showSuccessToast(t("steamgriddb_artwork_updated"));
  }, [showSuccessToast, t]);

  const {
    items,
    currentArtworkId,
    isLoading,
    hasMore,
    isStale,
    hasFailed,
    pendingId,
    loadNextPage,
    reloadSelection,
    reload,
    pick,
  } = useGameArtworkGrid({
    shop: game.shop,
    objectId: game.objectId,
    assetType,
    enabled: Boolean(userDetails),
    onChanged,
    onError,
    onPicked,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionVersionRef = useRef(selectionVersion);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);
  const [pendingStaticArtworkId, setPendingStaticArtworkId] = useState<
    number | null
  >(null);
  const [settledArtworkIds, setSettledArtworkIds] = useState<Set<number>>(
    () => new Set()
  );

  const isBusy =
    disabled || pendingId !== null || pendingStaticArtworkId !== null;

  const handleMediaSettled = useCallback((artworkId: number) => {
    setSettledArtworkIds((currentIds) => {
      if (currentIds.has(artworkId)) return currentIds;

      const nextIds = new Set(currentIds);
      nextIds.add(artworkId);
      return nextIds;
    });
  }, []);

  const handlePick = async (item: ArtworkItem) => {
    if (isAnimatedArtworkItem(item)) {
      await pick(item);
      return;
    }

    setPendingStaticArtworkId(item.id);

    try {
      const shouldApplyDirectly = await onSelectArtwork({
        artworkUrl: getRenderableArtworkUrl(item, assetType),
        artworkId: item.id,
      });

      if (shouldApplyDirectly) {
        await pick(item);
      }
    } catch {
      showErrorToast(tProfile("image_process_failure"));
    } finally {
      setPendingStaticArtworkId(null);
    }
  };

  useEffect(() => {
    if (selectionVersionRef.current === selectionVersion) return;

    selectionVersionRef.current = selectionVersion;
    reloadSelection().catch(() => {});
  }, [reloadSelection, selectionVersion]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const { minColumnWidth, aspectRatio, maxColumns } = GRID_CONFIG[assetType];

  const columnsCount = useMemo(() => {
    const fitColumns = Math.max(
      1,
      Math.floor((containerWidth + GAP) / (minColumnWidth + GAP))
    );
    return maxColumns ? Math.min(maxColumns, fitColumns) : fitColumns;
  }, [containerWidth, minColumnWidth, maxColumns]);

  let skeletonCount = 0;
  if (isLoading) {
    skeletonCount = items.length
      ? MORE_SKELETON_COUNT
      : INITIAL_SKELETON_COUNT[assetType];
  }
  const totalCells = items.length + skeletonCount;
  const rowCount = Math.ceil(totalCells / columnsCount);
  const itemRowCount = Math.ceil(items.length / columnsCount);
  const lastArtworkRowIds = useMemo(
    () => getLastArtworkRowIds(items, columnsCount),
    [items, columnsCount]
  );
  const isLastArtworkRowSettled = isArtworkRowSettled(
    lastArtworkRowIds,
    settledArtworkIds
  );

  const rowHeight = useMemo(() => {
    const columnWidth =
      containerWidth > 0
        ? (containerWidth - GAP * (columnsCount - 1)) / columnsCount
        : minColumnWidth;
    return columnWidth * aspectRatio + GAP;
  }, [containerWidth, columnsCount, aspectRatio, minColumnWidth]);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, rowHeight]);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastVirtualRowIndex = virtualRows.at(-1)?.index;

  useEffect(() => {
    if (lastVirtualRowIndex == null) return;
    if (
      lastVirtualRowIndex >= itemRowCount - 1 &&
      hasMore &&
      !isLoading &&
      isLastArtworkRowSettled
    ) {
      loadNextPage();
    }
  }, [
    lastVirtualRowIndex,
    itemRowCount,
    hasMore,
    isLoading,
    isLastArtworkRowSettled,
    loadNextPage,
  ]);

  useEffect(() => {
    setSettledArtworkIds(new Set());
    setIsScrolled(false);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [assetType, game.objectId, game.shop]);

  if (!userDetails) {
    return (
      <div className="game-artwork__hint">
        {t("steamgriddb_sign_in_required")}
      </div>
    );
  }

  const showReload = isStale || hasFailed;
  const isEmpty = !isLoading && items.length === 0;

  return (
    <div className="game-artwork">
      <div className="game-artwork__header">
        <span className="game-artwork__title">
          {t("steamgriddb_section_title")}
        </span>
        <span className="game-artwork__divider" aria-hidden="true" />

        {showReload && (
          <Button
            type="button"
            theme="outline"
            onClick={reload}
            disabled={isBusy}
          >
            {t("steamgriddb_refresh")}
          </Button>
        )}
      </div>

      {isStale && (
        <span className="game-artwork__hint">
          {t("steamgriddb_stale_cache")}
        </span>
      )}

      <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
        <div
          className={`game-artwork__scroll${isEmpty ? " game-artwork__scroll--empty" : ""}`}
          ref={scrollRef}
          onScroll={(event) => setIsScrolled(event.currentTarget.scrollTop > 0)}
        >
          <div
            className={`game-artwork__scroll-shadow${isScrolled ? " game-artwork__scroll-shadow--visible" : ""}`}
            aria-hidden="true"
          />
          {rowCount > 0 && (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
              }}
            >
              {virtualRows.map((virtualRow) => {
                const startCell = virtualRow.index * columnsCount;
                const cellCount = Math.min(
                  columnsCount,
                  totalCells - startCell
                );

                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                      display: "grid",
                      gridTemplateColumns: `repeat(${columnsCount}, 1fr)`,
                      gap: `${GAP}px`,
                    }}
                  >
                    {Array.from({ length: cellCount }).map((_, cell) => {
                      const cellIndex = startCell + cell;
                      const item = items[cellIndex];

                      if (!item) {
                        return (
                          <div
                            key={`skeleton-${cellIndex}`}
                            className={`game-artwork__item game-artwork__item--${assetType}`}
                          >
                            <Skeleton
                              containerClassName="game-artwork__skeleton"
                              height="100%"
                              width="100%"
                            />
                          </div>
                        );
                      }

                      return (
                        <ArtworkTile
                          key={item.id}
                          item={item}
                          assetType={assetType}
                          isActive={currentArtworkId === item.id}
                          isBusy={isBusy}
                          isPending={
                            pendingId === item.id ||
                            pendingStaticArtworkId === item.id
                          }
                          isMediaSettled={settledArtworkIds.has(item.id)}
                          onPick={handlePick}
                          onMediaSettled={handleMediaSettled}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {isEmpty && (
            <span className="game-artwork__hint">
              {t("steamgriddb_no_results")}
            </span>
          )}
        </div>
      </SkeletonTheme>
    </div>
  );
}
