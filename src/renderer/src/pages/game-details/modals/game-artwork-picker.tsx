import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
const SCROLL_END_PADDING = 20;
const SCROLLBAR_MIN_THUMB_SIZE = 24;
const SCROLL_STEP = 40;

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

interface ArtworkScrollbarProps {
  scrollRef: React.RefObject<HTMLDivElement>;
  contentRef: React.RefObject<HTMLDivElement>;
  scrollId: string;
  label: string;
}

interface ScrollbarMetrics {
  isVisible: boolean;
  scrollRange: number;
  scrollTop: number;
  thumbHeight: number;
  thumbTop: number;
  thumbTravel: number;
}

const INITIAL_SCROLLBAR_METRICS: ScrollbarMetrics = {
  isVisible: false,
  scrollRange: 0,
  scrollTop: 0,
  thumbHeight: 0,
  thumbTop: 0,
  thumbTravel: 0,
};

function ArtworkScrollbar({
  scrollRef,
  contentRef,
  scrollId,
  label,
}: Readonly<ArtworkScrollbarProps>) {
  const [metrics, setMetrics] = useState(INITIAL_SCROLLBAR_METRICS);
  const dragStateRef = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
  } | null>(null);

  const updateMetrics = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const scrollRange = Math.max(
      0,
      element.scrollHeight - element.clientHeight
    );
    const trackHeight = Math.max(0, element.clientHeight - SCROLL_END_PADDING);
    const isVisible = scrollRange > 0 && trackHeight > 0;

    if (!isVisible) {
      setMetrics(INITIAL_SCROLLBAR_METRICS);
      return;
    }

    const thumbHeight = Math.min(
      trackHeight,
      Math.max(
        SCROLLBAR_MIN_THUMB_SIZE,
        (element.clientHeight / element.scrollHeight) * trackHeight
      )
    );
    const thumbTravel = Math.max(0, trackHeight - thumbHeight);
    const thumbTop =
      scrollRange > 0
        ? Math.min(thumbTravel, (element.scrollTop / scrollRange) * thumbTravel)
        : 0;

    setMetrics({
      isVisible,
      scrollRange,
      scrollTop: element.scrollTop,
      thumbHeight,
      thumbTop,
      thumbTravel,
    });
  }, [scrollRef]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    const contentElement = contentRef.current;
    if (!scrollElement || !contentElement) return;

    updateMetrics();

    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(scrollElement);
    resizeObserver.observe(contentElement);
    scrollElement.addEventListener("scroll", updateMetrics, { passive: true });

    return () => {
      resizeObserver.disconnect();
      scrollElement.removeEventListener("scroll", updateMetrics);
    };
  }, [contentRef, scrollRef, updateMetrics]);

  const scrollToThumbPosition = (thumbTop: number) => {
    const element = scrollRef.current;
    if (!element || metrics.thumbTravel <= 0) return;

    const clampedThumbTop = Math.max(
      0,
      Math.min(metrics.thumbTravel, thumbTop)
    );
    element.scrollTop =
      (clampedThumbTop / metrics.thumbTravel) * metrics.scrollRange;
  };

  const handleTrackPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (event.target !== event.currentTarget) return;

    event.preventDefault();
    const trackRect = event.currentTarget.getBoundingClientRect();
    scrollToThumbPosition(
      event.clientY - trackRect.top - metrics.thumbHeight / 2
    );
  };

  const handleThumbPointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    const element = scrollRef.current;
    if (!element) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: element.scrollTop,
    };
  };

  const handleThumbPointerMove = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    const element = scrollRef.current;
    const dragState = dragStateRef.current;
    if (
      !element ||
      dragState?.pointerId !== event.pointerId ||
      metrics.thumbTravel <= 0
    ) {
      return;
    }

    const scrollDelta =
      ((event.clientY - dragState.startY) / metrics.thumbTravel) *
      metrics.scrollRange;
    element.scrollTop = dragState.startScrollTop + scrollDelta;
  };

  const handleThumbPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element) return;

    event.preventDefault();
    event.stopPropagation();
    let scrollDelta = event.deltaY;

    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      scrollDelta *= SCROLL_STEP;
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      scrollDelta *= element.clientHeight;
    }

    element.scrollTop += scrollDelta;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element) return;

    let nextScrollTop: number | null = null;

    switch (event.key) {
      case "ArrowUp":
        nextScrollTop = element.scrollTop - SCROLL_STEP;
        break;
      case "ArrowDown":
        nextScrollTop = element.scrollTop + SCROLL_STEP;
        break;
      case "PageUp":
        nextScrollTop = element.scrollTop - element.clientHeight;
        break;
      case "PageDown":
        nextScrollTop = element.scrollTop + element.clientHeight;
        break;
      case "Home":
        nextScrollTop = 0;
        break;
      case "End":
        nextScrollTop = metrics.scrollRange;
        break;
      default:
        return;
    }

    event.preventDefault();
    element.scrollTop = nextScrollTop;
  };

  if (!metrics.isVisible) return null;

  return (
    <div
      className="game-artwork__scrollbar"
      style={{ bottom: `${SCROLL_END_PADDING}px` }}
      role="scrollbar"
      tabIndex={0}
      aria-controls={scrollId}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.round(metrics.scrollRange)}
      aria-valuenow={Math.round(metrics.scrollTop)}
      onPointerDown={handleTrackPointerDown}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="game-artwork__scrollbar-thumb"
        style={{
          height: `${metrics.thumbHeight}px`,
          transform: `translateY(${metrics.thumbTop}px)`,
        }}
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={handleThumbPointerEnd}
        onPointerCancel={handleThumbPointerEnd}
      />
    </div>
  );
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
  const scrollId = useId();

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
  const scrollContentRef = useRef<HTMLDivElement>(null);
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
    const element = scrollContentRef.current;
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
    return columnWidth * aspectRatio;
  }, [containerWidth, columnsCount, aspectRatio, minColumnWidth]);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    gap: GAP,
    paddingEnd: SCROLL_END_PADDING,
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
        <div className="game-artwork__scroll-shell">
          <div
            className={`game-artwork__scroll${isEmpty ? " game-artwork__scroll--empty" : ""}`}
            id={scrollId}
            ref={scrollRef}
            onScroll={(event) =>
              setIsScrolled(event.currentTarget.scrollTop > 0)
            }
          >
            <div
              ref={scrollContentRef}
              className="game-artwork__scroll-content"
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
          </div>
          <ArtworkScrollbar
            scrollRef={scrollRef}
            contentRef={scrollContentRef}
            scrollId={scrollId}
            label={t("steamgriddb_section_title")}
          />
        </div>
      </SkeletonTheme>
    </div>
  );
}
