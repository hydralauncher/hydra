import { FocusItem, GridFocusGroup, Typography } from "../../components";
import {
  CATALOGUE_EMPTY_STATE_ID,
  CATALOGUE_ERROR_STATE_ID,
  CATALOGUE_GRID_REGION_ID,
  getCatalogueCardFocusId,
} from "./navigation";
import type { SearchGamesResponseData } from "./use-catalogue-data";
import { CatalogueCard } from "./card";
import { CatalogueSkeletonCard } from "./skeleton-card";
import { useCatalogueGridNavigation } from "./use-catalogue-grid-navigation";

interface GridProps {
  pageSize: number;
  search: {
    data: SearchGamesResponseData | undefined;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    isEmpty: boolean;
  };
}

export function CatalogueGrid({ search, pageSize }: Readonly<GridProps>) {
  const gridItems = search.data?.edges ?? [];
  const itemIds = search.isLoading
    ? []
    : search.isError
      ? [CATALOGUE_ERROR_STATE_ID]
      : search.isEmpty
        ? [CATALOGUE_EMPTY_STATE_ID]
        : gridItems.map((item) => getCatalogueCardFocusId(item.id));
  const navigationOverridesByItemId = useCatalogueGridNavigation(itemIds);

  return (
    <GridFocusGroup
      regionId={CATALOGUE_GRID_REGION_ID}
      className="catalogue-grid"
    >
      {search.isLoading ? (
        <>
          <div className="catalogue-grid__status catalogue-grid__status--loading">
            <Typography variant="label">Loading catalogue…</Typography>
          </div>

          {Array.from({ length: pageSize }, (_, index) => (
            <CatalogueSkeletonCard key={`catalogue-skeleton-${index}`} />
          ))}
        </>
      ) : null}

      {!search.isLoading &&
        gridItems.map((item) => (
          <CatalogueCard
            key={item.id}
            game={item}
            navigationOverrides={
              navigationOverridesByItemId[getCatalogueCardFocusId(item.id)]
            }
          />
        ))}

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

      {!search.isLoading && search.isError ? (
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
    </GridFocusGroup>
  );
}
