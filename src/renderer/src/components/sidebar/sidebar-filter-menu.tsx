import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  CheckIcon,
  ClockIcon,
  DeviceDesktopIcon,
  DownloadIcon,
  HeartIcon,
  HourglassIcon,
  SlidersIcon,
  SortDescIcon,
  StackIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import {
  ClassicsIcon,
  type LibraryCategory,
} from "@renderer/pages/library/category-filter";
import {
  LIBRARY_SOURCES,
  type LibrarySource,
} from "@renderer/pages/library/library-category";
import type { SortOption } from "@renderer/pages/library/filter-options";
import { SourceIcon } from "@renderer/pages/library/source-icon";
import "./sidebar-filter-menu.scss";

const MENU_SIDE_OFFSET = 8;
const MENU_COLLISION_PADDING = 16;

interface SidebarFilterMenuProps {
  category: LibraryCategory;
  onCategoryChange: (category: LibraryCategory) => void;
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
  showFavoritesFirst: boolean;
  onToggleFavoritesFirst: (next: boolean) => void;
  showSources: boolean;
  selectedSources: LibrarySource[];
  onSourcesChange: (sources: LibrarySource[]) => void;
  showPlatforms: boolean;
  platforms: string[];
  selectedPlatforms: string[];
  onPlatformsChange: (platforms: string[]) => void;
}

interface FilterGroupOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface FilterGroupProps {
  label: string;
  allLabel: string;
  options: FilterGroupOption[];
  selected: string[];
  singleSelect?: boolean;
  onChange: (selected: string[]) => void;
}

function FilterGroup({
  label,
  allLabel,
  options,
  selected,
  singleSelect = false,
  onChange,
}: Readonly<FilterGroupProps>) {
  const handleToggle = (value: string, checked: boolean) => {
    if (singleSelect) {
      onChange([value]);
      return;
    }

    if (checked) {
      if (selected.includes(value)) return;
      onChange([...selected, value]);
      return;
    }

    if (selected.length <= 1) {
      onChange([]);
      return;
    }

    onChange(selected.filter((item) => item !== value));
  };

  return (
    <DropdownMenuPrimitive.Group className="sidebar-filter-menu__group">
      <DropdownMenuPrimitive.Label className="sidebar-filter-menu__label">
        {label}
      </DropdownMenuPrimitive.Label>

      <DropdownMenuPrimitive.CheckboxItem
        checked={selected.length === 0}
        onCheckedChange={(checked) => {
          if (checked === true) onChange([]);
        }}
        onSelect={(event) => event.preventDefault()}
        className="sidebar-filter-menu__item"
      >
        <span className="sidebar-filter-menu__item-label">{allLabel}</span>
        <DropdownMenuPrimitive.ItemIndicator
          forceMount
          className="sidebar-filter-menu__item-indicator"
        >
          <CheckIcon size={14} />
        </DropdownMenuPrimitive.ItemIndicator>
      </DropdownMenuPrimitive.CheckboxItem>

      {options.map((option) => (
        <DropdownMenuPrimitive.CheckboxItem
          key={option.value}
          checked={selected.includes(option.value)}
          onCheckedChange={(checked) =>
            handleToggle(option.value, checked === true)
          }
          onSelect={(event) => event.preventDefault()}
          className="sidebar-filter-menu__item"
        >
          {option.icon}
          <span className="sidebar-filter-menu__item-label">
            {option.label}
          </span>
          <DropdownMenuPrimitive.ItemIndicator
            forceMount
            className="sidebar-filter-menu__item-indicator"
          >
            <CheckIcon size={14} />
          </DropdownMenuPrimitive.ItemIndicator>
        </DropdownMenuPrimitive.CheckboxItem>
      ))}
    </DropdownMenuPrimitive.Group>
  );
}

export function SidebarFilterMenu({
  category,
  onCategoryChange,
  sortBy,
  onSortChange,
  showFavoritesFirst,
  onToggleFavoritesFirst,
  showSources,
  selectedSources,
  onSourcesChange,
  showPlatforms,
  platforms,
  selectedPlatforms,
  onPlatformsChange,
}: Readonly<SidebarFilterMenuProps>) {
  const { t } = useTranslation(["sidebar", "library"]);

  const tooltipId = useId();
  const pointerInteractionRef = useRef(false);

  const categoryOptions: {
    value: LibraryCategory;
    label: string;
    icon: JSX.Element;
  }[] = [
    {
      value: "all",
      label: t("category_all", { ns: "library" }),
      icon: <StackIcon size={14} />,
    },
    {
      value: "pc",
      label: t("category_pc", { ns: "library" }),
      icon: <DeviceDesktopIcon size={14} />,
    },
    {
      value: "classics",
      label: t("category_classics", { ns: "library" }),
      icon: <ClassicsIcon size={14} />,
    },
  ];

  const sortOptions: {
    value: SortOption;
    label: string;
    icon: JSX.Element;
  }[] = [
    {
      value: "title_asc",
      label: t("sort_title", { ns: "library" }),
      icon: <SortDescIcon size={14} />,
    },
    {
      value: "recently_played",
      label: t("recently_played", { ns: "library" }),
      icon: <ClockIcon size={14} />,
    },
    {
      value: "recently_downloaded",
      label: t("sort_recently_downloaded", { ns: "library" }),
      icon: <DownloadIcon size={14} />,
    },
    {
      value: "most_played",
      label: t("sort_most_played", { ns: "library" }),
      icon: <HourglassIcon size={14} />,
    },
    {
      value: "achievements",
      label: t("sort_achievements", { ns: "library" }),
      icon: <TrophyIcon size={14} />,
    },
  ];

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className="sidebar__add-button sidebar-filter-menu__trigger"
          aria-label={t("filter_sort_tooltip")}
          data-tooltip-id={tooltipId}
          data-tooltip-content={t("filter_sort_tooltip")}
          data-tooltip-place="top"
          onPointerDown={() => {
            pointerInteractionRef.current = true;
          }}
        >
          <SlidersIcon size={16} />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <Tooltip id={tooltipId} place="top" />

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          side="right"
          align="start"
          sideOffset={MENU_SIDE_OFFSET}
          collisionPadding={MENU_COLLISION_PADDING}
          className="sidebar-filter-menu__content"
          onCloseAutoFocus={(event) => {
            if (pointerInteractionRef.current) {
              event.preventDefault();
            }
            pointerInteractionRef.current = false;
          }}
        >
          <div className="sidebar-filter-menu__column">
            <DropdownMenuPrimitive.Group className="sidebar-filter-menu__group">
              <DropdownMenuPrimitive.Label className="sidebar-filter-menu__label">
                {t("platforms_label")}
              </DropdownMenuPrimitive.Label>

              <DropdownMenuPrimitive.RadioGroup
                value={category}
                onValueChange={(value) =>
                  onCategoryChange(value as LibraryCategory)
                }
              >
                {categoryOptions.map((option) => (
                  <DropdownMenuPrimitive.RadioItem
                    key={option.value}
                    value={option.value}
                    onSelect={(event) => event.preventDefault()}
                    className="sidebar-filter-menu__item"
                  >
                    {option.icon}
                    <span>{option.label}</span>
                    <DropdownMenuPrimitive.ItemIndicator
                      forceMount
                      className="sidebar-filter-menu__item-indicator"
                    >
                      <CheckIcon size={14} />
                    </DropdownMenuPrimitive.ItemIndicator>
                  </DropdownMenuPrimitive.RadioItem>
                ))}
              </DropdownMenuPrimitive.RadioGroup>
            </DropdownMenuPrimitive.Group>

            <DropdownMenuPrimitive.Separator className="sidebar-filter-menu__separator" />

            <DropdownMenuPrimitive.Group className="sidebar-filter-menu__group">
              <DropdownMenuPrimitive.Label className="sidebar-filter-menu__label">
                {t("sort_by", { ns: "library" })}
              </DropdownMenuPrimitive.Label>

              <DropdownMenuPrimitive.CheckboxItem
                checked={showFavoritesFirst}
                onCheckedChange={onToggleFavoritesFirst}
                onSelect={(event) => event.preventDefault()}
                className="sidebar-filter-menu__item"
              >
                <HeartIcon size={14} />
                <span>{t("show_favorites_first")}</span>
                <DropdownMenuPrimitive.ItemIndicator
                  forceMount
                  className="sidebar-filter-menu__item-indicator"
                >
                  <CheckIcon size={14} />
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.CheckboxItem>

              <DropdownMenuPrimitive.RadioGroup
                value={sortBy}
                onValueChange={(value) => onSortChange(value as SortOption)}
              >
                {sortOptions.map((option) => (
                  <DropdownMenuPrimitive.RadioItem
                    key={option.value}
                    value={option.value}
                    onSelect={(event) => event.preventDefault()}
                    className="sidebar-filter-menu__item"
                  >
                    {option.icon}
                    <span>{option.label}</span>
                    <DropdownMenuPrimitive.ItemIndicator
                      forceMount
                      className="sidebar-filter-menu__item-indicator"
                    >
                      <CheckIcon size={14} />
                    </DropdownMenuPrimitive.ItemIndicator>
                  </DropdownMenuPrimitive.RadioItem>
                ))}
              </DropdownMenuPrimitive.RadioGroup>
            </DropdownMenuPrimitive.Group>
          </div>

          {(showSources || showPlatforms) && (
            <>
              <div className="sidebar-filter-menu__divider" />

              <div className="sidebar-filter-menu__column">
                {showSources && (
                  <FilterGroup
                    label={t("libraries_label")}
                    allLabel={t("all_libraries", { ns: "library" })}
                    options={LIBRARY_SOURCES.map((source) => ({
                      value: source,
                      label: t(`library_${source}`, { ns: "library" }),
                      icon: <SourceIcon source={source} />,
                    }))}
                    selected={selectedSources}
                    singleSelect
                    onChange={(sources) =>
                      onSourcesChange(
                        LIBRARY_SOURCES.filter((source) =>
                          sources.includes(source)
                        )
                      )
                    }
                  />
                )}

                {showSources && showPlatforms && (
                  <DropdownMenuPrimitive.Separator className="sidebar-filter-menu__separator" />
                )}

                {showPlatforms && (
                  <FilterGroup
                    label={t("consoles_label")}
                    allLabel={t("all_consoles", { ns: "library" })}
                    options={platforms.map((platform) => ({
                      value: platform,
                      label: platform,
                    }))}
                    selected={selectedPlatforms}
                    onChange={onPlatformsChange}
                  />
                )}
              </div>
            </>
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
