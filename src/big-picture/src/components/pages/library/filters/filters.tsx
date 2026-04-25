import "./filters.scss";
import {
  Button,
  FocusItem,
  HorizontalFocusGroup,
  Input,
  Tabs,
} from "../../../common";
import {
  ListDashesIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import type { FocusOverrides } from "../../../../services";
import {
  LIBRARY_FILTERS_SEARCH_INPUT_ID,
  LIBRARY_FILTERS_TABS_REGION_ID,
  LIBRARY_FILTERS_TOOLBAR_REGION_ID,
  LIBRARY_HERO_ACTIONS_REGION_ID,
} from "../navigation";
import type { LibraryFilterCounts, LibraryFilterTab } from "../library-data";

export interface LibraryFiltersProps {
  selectedTab: LibraryFilterTab;
  onSelectedTabChange: (tab: LibraryFilterTab) => void;
  search: string;
  onSearchChange: (search: string) => void;
  counts: LibraryFilterCounts;
  firstGridItemId?: string | null;
}

export function LibraryFilters({
  selectedTab,
  onSelectedTabChange,
  search,
  onSearchChange,
  counts,
  firstGridItemId = null,
}: Readonly<LibraryFiltersProps>) {
  const tabs = [
    { value: "all", label: `All (${counts.all})` },
    { value: "favorites", label: `Favorites (${counts.favorites})` },
    { value: "completed", label: `Completed (${counts.completed})` },
  ] satisfies Array<{ value: LibraryFilterTab; label: string }>;
  const toolbarNavigationOverrides: FocusOverrides = {
    up: {
      type: "region",
      regionId: LIBRARY_HERO_ACTIONS_REGION_ID,
      entryDirection: "up",
    },
    down: {
      type: "region",
      regionId: LIBRARY_FILTERS_TABS_REGION_ID,
      entryDirection: "down",
    },
  };
  const tabsNavigationOverrides: FocusOverrides = {
    up: {
      type: "region",
      regionId: LIBRARY_FILTERS_TOOLBAR_REGION_ID,
      entryDirection: "up",
    },
    down: firstGridItemId
      ? {
          type: "item",
          itemId: firstGridItemId,
        }
      : {
          type: "block",
        },
  };

  return (
    <div className="library-filters">
      <div className="library-filters__header">
        <h2 className="library-filters__title">Your Library</h2>
      </div>

      <HorizontalFocusGroup
        className="library-filters__toolbar"
        regionId={LIBRARY_FILTERS_TOOLBAR_REGION_ID}
        navigationOverrides={toolbarNavigationOverrides}
      >
        <div className="library-filters__search">
          <FocusItem id={LIBRARY_FILTERS_SEARCH_INPUT_ID}>
            <Input
              type="text"
              placeholder="Search library"
              iconLeft={<MagnifyingGlassIcon size={24} />}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </FocusItem>
        </div>

        <div className="library-filters__view-actions">
          <Button
            className="library-filters__view-button library-filters__view-button--list"
            variant="secondary"
            size="icon"
          >
            <ListDashesIcon
              className="library-filters__view-icon library-filters__view-icon--list"
              size={24}
            />
          </Button>

          <Button
            className="library-filters__view-button library-filters__view-button--grid"
            variant="secondary"
            size="icon"
          >
            <SquaresFourIcon
              className="library-filters__view-icon library-filters__view-icon--grid"
              size={24}
            />
          </Button>
        </div>
      </HorizontalFocusGroup>

      <div className="library-filters__tabs">
        <Tabs
          items={tabs}
          value={selectedTab}
          onValueChange={onSelectedTabChange}
          regionId={LIBRARY_FILTERS_TABS_REGION_ID}
          navigationOverrides={tabsNavigationOverrides}
          ariaLabel="Library filters"
        />
      </div>
    </div>
  );
}
