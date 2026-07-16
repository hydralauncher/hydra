import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import {
  getArtworkDisplaySource,
  getRenderableArtworkUrl,
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

interface GameArtworkPickerProps {
  game: LibraryGame;
  assetType: ArtworkAssetType;
  onChanged: () => Promise<void> | void;
  onSelectArtwork: (artworkUrl: string) => Promise<void>;
}

export function GameArtworkPicker({
  game,
  assetType,
  onChanged,
  onSelectArtwork,
}: Readonly<GameArtworkPickerProps>) {
  const { t } = useTranslation("sidebar");
  const { showErrorToast, showSuccessToast } = useToast();
  const { userDetails } = useUserDetails();

  const onError = useCallback(() => {
    showErrorToast(t("steamgriddb_fetch_failed"));
  }, [showErrorToast, t]);

  const onCleared = useCallback(() => {
    showSuccessToast(t("steamgriddb_artwork_reset"));
  }, [showSuccessToast, t]);

  const {
    items,
    currentArtworkId,
    isLoading,
    hasMore,
    isStale,
    hasFailed,
    loadNextPage,
    reload,
    clear,
  } = useGameArtworkGrid({
    shop: game.shop,
    objectId: game.objectId,
    assetType,
    enabled: Boolean(userDetails),
    onChanged,
    onError,
    onCleared,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pendingArtworkId, setPendingArtworkId] = useState<number | null>(null);

  const handleSelectArtwork = async (item: ArtworkItem) => {
    setPendingArtworkId(item.id);

    try {
      await onSelectArtwork(getRenderableArtworkUrl(item, assetType));
    } catch {
      onError();
    } finally {
      setPendingArtworkId(null);
    }
  };

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

  const skeletonCount = isLoading
    ? items.length
      ? MORE_SKELETON_COUNT
      : INITIAL_SKELETON_COUNT[assetType]
    : 0;
  const totalCells = items.length + skeletonCount;
  const rowCount = Math.ceil(totalCells / columnsCount);
  const itemRowCount = Math.ceil(items.length / columnsCount);

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

  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastVirtualRowIndex = virtualRows[virtualRows.length - 1]?.index;

  useEffect(() => {
    if (lastVirtualRowIndex == null) return;
    if (lastVirtualRowIndex >= itemRowCount - 1 && hasMore && !isLoading) {
      loadNextPage();
    }
  }, [lastVirtualRowIndex, itemRowCount, hasMore, isLoading, loadNextPage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [assetType]);

  if (!userDetails) {
    return (
      <div className="game-artwork__hint">
        {t("steamgriddb_sign_in_required")}
      </div>
    );
  }

  const showReload = isStale || hasFailed;

  return (
    <div className="game-artwork">
      <div className="game-artwork__header">
        <span className="game-artwork__title">
          {t("steamgriddb_section_title")}
        </span>

        <div className="game-artwork__actions">
          {showReload && (
            <Button type="button" theme="outline" onClick={reload}>
              {t("steamgriddb_refresh")}
            </Button>
          )}

          <Button
            type="button"
            theme="outline"
            onClick={clear}
            disabled={isLoading}
          >
            {t("steamgriddb_use_default")}
          </Button>
        </div>
      </div>

      {isStale && (
        <span className="game-artwork__hint">
          {t("steamgriddb_stale_cache")}
        </span>
      )}

      <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
        <div className="game-artwork__scroll" ref={scrollRef}>
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

                      const isActive = currentArtworkId === item.id;
                      const display = getArtworkDisplaySource(item);

                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`game-artwork__item game-artwork__item--${assetType} ${
                            isActive ? "game-artwork__item--active" : ""
                          }`}
                          onClick={() => void handleSelectArtwork(item)}
                          disabled={pendingArtworkId !== null}
                        >
                          {display.isVideo ? (
                            <video
                              src={display.src}
                              autoPlay
                              loop
                              muted
                              playsInline
                              disablePictureInPicture
                            />
                          ) : (
                            <img src={display.src} alt="" loading="lazy" />
                          )}
                          {isActive && (
                            <span
                              className="game-artwork__item-check"
                              aria-hidden="true"
                            >
                              <CheckIcon size={14} />
                            </span>
                          )}
                          {pendingArtworkId === item.id && (
                            <span
                              className="game-artwork__item-spinner"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {!isLoading && !items.length && (
            <span className="game-artwork__hint">
              {t("steamgriddb_no_results")}
            </span>
          )}
        </div>
      </SkeletonTheme>
    </div>
  );
}
