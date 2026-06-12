import { useEffect, useRef } from "react";
import { FocusItem, GridFocusGroup, Typography } from "../../components";
import {
  CATALOGUE_EMPTY_STATE_ID,
  CATALOGUE_ERROR_STATE_ID,
  CATALOGUE_GRID_REGION_ID,
  getCatalogueCardFocusId,
} from "./navigation";
import type {
  CatalogueMode,
  SearchGamesResponseData,
} from "./use-catalogue-data";
import { CatalogueCard } from "./card";
import { CatalogueSkeletonCard } from "./skeleton-card";
import { useCatalogueGridNavigation } from "./use-catalogue-grid-navigation";

interface GridProps {
  mode: CatalogueMode;
  pageSize: number;
  hasNextPage: boolean;
  loadMore: () => void;
  search: {
    data: SearchGamesResponseData | undefined;
    isLoading: boolean;
    isLoadingMore: boolean;
    isError: boolean;
    error: Error | null;
    isEmpty: boolean;
  };
}

export function CatalogueGrid({
  mode,
  search,
  pageSize,
  hasNextPage,
  loadMore,
}: Readonly<GridProps>) {
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const gridItems = search.data?.edges ?? [];
  const hasGridItems = gridItems.length > 0;
  const itemIds =
    search.isLoading && !hasGridItems
      ? []
      : search.isError && !hasGridItems
        ? [CATALOGUE_ERROR_STATE_ID]
        : search.isEmpty
          ? [CATALOGUE_EMPTY_STATE_ID]
          : gridItems.map((item) => getCatalogueCardFocusId(item.id));
  const navigationOverridesByItemId = useCatalogueGridNavigation(itemIds);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;

    if (
      !sentinel ||
      !hasNextPage ||
      search.isLoading ||
      search.isLoadingMore ||
      search.isError
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "640px 0px" }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [
    hasNextPage,
    loadMore,
    search.isError,
    search.isLoading,
    search.isLoadingMore,
  ]);

  return (
    <GridFocusGroup
      regionId={CATALOGUE_GRID_REGION_ID}
      className="catalogue-grid"
    >
      {search.isLoading && !hasGridItems ? (
        <>
          {Array.from({ length: pageSize }, (_, index) => (
            <CatalogueSkeletonCard
              key={`catalogue-skeleton-${index}`}
              mode={mode}
            />
          ))}
        </>
      ) : null}

      {gridItems.map((item) => (
        <CatalogueCard
          key={item.id}
          game={item}
          navigationOverrides={
            navigationOverridesByItemId[getCatalogueCardFocusId(item.id)]
          }
        />
      ))}

      {search.isLoadingMore
        ? Array.from({ length: pageSize }, (_, index) => (
            <CatalogueSkeletonCard
              key={`catalogue-load-more-skeleton-${index}`}
              mode={mode}
            />
          ))
        : null}

      {hasGridItems && search.isError ? (
        <div className="catalogue-grid__status catalogue-grid__status--wide">
          <Typography variant="label">
            {search.error?.message ?? "Failed to load more games"}
          </Typography>
        </div>
      ) : null}

      {!search.isLoading && !search.isError && search.isEmpty ? (
        <FocusItem
          id={CATALOGUE_EMPTY_STATE_ID}
          navigationOverrides={
            navigationOverridesByItemId[CATALOGUE_EMPTY_STATE_ID]
          }
          asChild
        >
          <div className="catalogue-grid__status">
            <Typography variant="label">No results found</Typography>
          </div>
        </FocusItem>
      ) : null}

      {!search.isLoading && search.isError && !hasGridItems ? (
        <FocusItem
          id={CATALOGUE_ERROR_STATE_ID}
          navigationOverrides={
            navigationOverridesByItemId[CATALOGUE_ERROR_STATE_ID]
          }
          asChild
        >
          <div className="catalogue-grid__status">
            <Typography variant="label">
              {search.error?.message ?? "Failed to load catalogue"}
            </Typography>
          </div>
        </FocusItem>
      ) : null}

      {hasGridItems && hasNextPage ? (
        <div
          ref={loadMoreSentinelRef}
          className="catalogue-grid__load-more-sentinel"
          aria-hidden
        />
      ) : null}
    </GridFocusGroup>
  );
}
