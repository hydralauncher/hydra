import "./filters.scss";

import {
  Button,
  Divider,
  DropdownSelect,
  type DropdownSelectOption,
  HorizontalFocusGroup,
  Input,
  Tabs,
  type TabsItem,
} from "../../../common";
import {
  FunnelIcon,
  ListDashesIcon,
  MagnifyingGlassIcon,
  SortAscendingIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import type { FocusOverrides } from "../../../../services";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import {
  LIBRARY_FILTERS_ALL_TAB_ID,
  LIBRARY_FILTERS_COMPLETED_TAB_ID,
  LIBRARY_FILTERS_FAVORITES_TAB_ID,
  LIBRARY_FILTERS_FILTER_SELECT_ID,
  LIBRARY_FILTERS_GRID_VIEW_BUTTON_ID,
  LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID,
  LIBRARY_FILTERS_SEARCH_INPUT_ID,
  LIBRARY_FILTERS_SORT_SELECT_ID,
  LIBRARY_FILTERS_TABS_REGION_ID,
  LIBRARY_FILTERS_TOOLBAR_REGION_ID,
  LIBRARY_HERO_ACTIONS_REGION_ID,
} from "../navigation";
import type {
  LibraryFilterCounts,
  LibraryFilterTab,
  LibrarySecondaryFilter,
  LibrarySortOption,
  LibraryViewMode,
} from "../library-data";

const SORT_OPTIONS = [
  { value: "last_played", label: "Last Played" },
  { value: "playtime", label: "Most Played" },
  { value: "title_asc", label: "Alphabetical (A-Z)" },
  { value: "title_desc", label: "Alphabetical (Z-A)" },
  { value: "added_desc", label: "Newest Added" },
  { value: "added_asc", label: "Oldest Added" },
] satisfies Array<DropdownSelectOption<LibrarySortOption>>;

const FILTER_OPTIONS = [
  { value: "all_games", label: "All Games" },
  { value: "installed", label: "Installed" },
  { value: "not_installed", label: "Not Installed" },
  { value: "never_played", label: "Never Played" },
] satisfies Array<DropdownSelectOption<LibrarySecondaryFilter>>;

export interface LibraryFiltersProps {
  selectedTab: LibraryFilterTab;
  onSelectedTabChange: (tab: LibraryFilterTab) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (viewMode: LibraryViewMode) => void;
  sortBy: LibrarySortOption;
  onSortByChange: (sortBy: LibrarySortOption) => void;
  filterBy: LibrarySecondaryFilter;
  onFilterByChange: (filterBy: LibrarySecondaryFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
  counts: LibraryFilterCounts;
  firstContentItemId?: string | null;
}

export function LibraryFilters({
  selectedTab,
  onSelectedTabChange,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortByChange,
  filterBy,
  onFilterByChange,
  search,
  onSearchChange,
  counts,
  firstContentItemId = null,
}: Readonly<LibraryFiltersProps>) {
  const tabDownOverride = firstContentItemId
    ? ({
        type: "item",
        itemId: firstContentItemId,
      } as const)
    : ({
        type: "block",
      } as const);
  const tabUpOverride = {
    type: "region",
    regionId: LIBRARY_FILTERS_TOOLBAR_REGION_ID,
    entryDirection: "up",
  } as const;
  const sidebarLibraryOverride = {
    type: "item",
    itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.library,
  } as const;
  const tabs = [
    {
      id: LIBRARY_FILTERS_ALL_TAB_ID,
      value: "all",
      label: `All (${counts.all})`,
      navigationOverrides: {
        left: sidebarLibraryOverride,
        right: {
          type: "item",
          itemId: LIBRARY_FILTERS_FAVORITES_TAB_ID,
        },
        up: tabUpOverride,
        down: tabDownOverride,
      },
    },
    {
      id: LIBRARY_FILTERS_FAVORITES_TAB_ID,
      value: "favorites",
      label: `Favorites (${counts.favorites})`,
      navigationOverrides: {
        left: {
          type: "item",
          itemId: LIBRARY_FILTERS_ALL_TAB_ID,
        },
        right: {
          type: "item",
          itemId: LIBRARY_FILTERS_COMPLETED_TAB_ID,
        },
        up: tabUpOverride,
        down: tabDownOverride,
      },
    },
    {
      id: LIBRARY_FILTERS_COMPLETED_TAB_ID,
      value: "completed",
      label: `Completed (${counts.completed})`,
      navigationOverrides: {
        left: {
          type: "item",
          itemId: LIBRARY_FILTERS_FAVORITES_TAB_ID,
        },
        right: { type: "block" },
        up: tabUpOverride,
        down: tabDownOverride,
      },
    },
  ] satisfies Array<TabsItem<LibraryFilterTab>>;
  const toolbarNavigationOverrides: FocusOverrides = {
    up: {
      type: "region",
      regionId: LIBRARY_HERO_ACTIONS_REGION_ID,
      entryDirection: "up",
    },
    down: {
      type: "item",
      itemId: LIBRARY_FILTERS_ALL_TAB_ID,
    },
  };
  const toolbarUpOverride = {
    type: "region",
    regionId: LIBRARY_HERO_ACTIONS_REGION_ID,
    entryDirection: "up",
  } as const;
  const toolbarDownOverride = {
    type: "item",
    itemId: LIBRARY_FILTERS_ALL_TAB_ID,
  } as const;
  const searchNavigationOverrides: FocusOverrides = {
    left: sidebarLibraryOverride,
    right: {
      type: "item",
      itemId: LIBRARY_FILTERS_SORT_SELECT_ID,
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const sortNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: LIBRARY_FILTERS_SEARCH_INPUT_ID,
    },
    right: {
      type: "item",
      itemId: LIBRARY_FILTERS_FILTER_SELECT_ID,
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const filterNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: LIBRARY_FILTERS_SORT_SELECT_ID,
    },
    right: {
      type: "item",
      itemId: LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID,
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const listViewNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: LIBRARY_FILTERS_FILTER_SELECT_ID,
    },
    right: {
      type: "item",
      itemId: LIBRARY_FILTERS_GRID_VIEW_BUTTON_ID,
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const gridViewNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID,
    },
    right: {
      type: "block",
    },
    up: toolbarUpOverride,
    down: toolbarDownOverride,
  };
  const tabsNavigationOverrides: FocusOverrides = {
    up: tabUpOverride,
    down: tabDownOverride,
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
        <div className="library-filters__search-and-filters">
          <div className="library-filters__search">
            <Input
              focusId={LIBRARY_FILTERS_SEARCH_INPUT_ID}
              focusNavigationOverrides={searchNavigationOverrides}
              type="text"
              placeholder="Search library"
              iconLeft={<MagnifyingGlassIcon size={24} />}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          <div className="library-filters__toolbar-divider" aria-hidden="true">
            <Divider orientation="vertical" color="var(--text-secondary)" />
          </div>

          <DropdownSelect
            className="library-filters__select"
            hideLabel
            leadingIcon={<SortAscendingIcon size={22} />}
            ariaLabel="Sort library by"
            focusId={LIBRARY_FILTERS_SORT_SELECT_ID}
            focusNavigationOverrides={sortNavigationOverrides}
            value={sortBy}
            options={SORT_OPTIONS}
            onValueChange={onSortByChange}
          />

          <DropdownSelect
            className="library-filters__select"
            hideLabel
            leadingIcon={<FunnelIcon size={20} />}
            ariaLabel="Filter library games"
            focusId={LIBRARY_FILTERS_FILTER_SELECT_ID}
            focusNavigationOverrides={filterNavigationOverrides}
            value={filterBy}
            options={FILTER_OPTIONS}
            onValueChange={onFilterByChange}
          />
        </div>

        <div className="library-filters__view-actions">
          <Button
            focusId={LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID}
            focusNavigationOverrides={listViewNavigationOverrides}
            className="library-filters__view-button library-filters__view-button--list"
            variant={viewMode === "list" ? "primary" : "secondary"}
            size="icon"
            aria-label="List view"
            aria-pressed={viewMode === "list"}
            onClick={() => onViewModeChange("list")}
          >
            <ListDashesIcon
              className="library-filters__view-icon library-filters__view-icon--list"
              size={24}
            />
          </Button>

          <Button
            focusId={LIBRARY_FILTERS_GRID_VIEW_BUTTON_ID}
            focusNavigationOverrides={gridViewNavigationOverrides}
            className="library-filters__view-button library-filters__view-button--grid"
            variant={viewMode === "grid" ? "primary" : "secondary"}
            size="icon"
            aria-label="Grid view"
            aria-pressed={viewMode === "grid"}
            onClick={() => onViewModeChange("grid")}
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
