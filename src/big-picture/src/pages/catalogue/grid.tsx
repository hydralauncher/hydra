import { FocusItem, GridFocusGroup, Typography } from "../../components";
import {
  CATALOGUE_FILTERS_REGION_ID,
  CATALOGUE_GRID_REGION_ID,
  CATALOGUE_LOADING_STATE_ID,
  getCatalogueCardFocusId,
} from "./navigation";
import type { SearchGamesResponseData } from "./use-catalogue-data";
import { PAGE_SIZE } from "./use-catalogue-data";
import { CatalogueCard } from "./card";
import { CatalogueSkeletonCard } from "./skeleton-card";
import { useCatalogueGridNavigation } from "./use-catalogue-grid-navigation";

interface GridProps {
  search: {
    data: SearchGamesResponseData | undefined;
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    isEmpty: boolean;
  };
}

export function CatalogueGrid({ search }: Readonly<GridProps>) {
  const gridItems = search.data?.edges ?? [];
  const navigationOverridesByItemId = useCatalogueGridNavigation(gridItems);

  return (
    <GridFocusGroup
      regionId={CATALOGUE_GRID_REGION_ID}
      className="catalogue-grid"
      navigationOverrides={{
        right: {
          type: "region",
          regionId: CATALOGUE_FILTERS_REGION_ID,
          entryDirection: "left",
        },
      }}
    >
      {search.isLoading ? (
        <>
          <FocusItem id={CATALOGUE_LOADING_STATE_ID}>
            <div className="catalogue-grid__status">
              <Typography variant="label">Loading catalogue…</Typography>
            </div>
          </FocusItem>

          {Array.from({ length: PAGE_SIZE }, (_, index) => (
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

      {!search.isLoading && search.isEmpty ? (
        <FocusItem id="catalogue-empty-state">
          <div className="catalogue-grid__status">
            <Typography variant="label">No results found</Typography>
          </div>
        </FocusItem>
      ) : null}

      {!search.isLoading && search.isError ? (
        <FocusItem id="catalogue-error-state">
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
