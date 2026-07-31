import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  CheckIcon,
  ClockIcon,
  DeviceDesktopIcon,
  HeartIcon,
  HourglassIcon,
  SlidersIcon,
  SortDescIcon,
  StackIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import {
  ClassicsIcon,
  type LibraryCategory,
} from "@renderer/pages/library/category-filter";
import type { SortOption } from "@renderer/pages/library/filter-options";
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
  platforms: string[];
  selectedPlatforms: string[];
  onPlatformsChange: (platforms: string[]) => void;
}

export function SidebarFilterMenu({
  category,
  onCategoryChange,
  sortBy,
  onSortChange,
  showFavoritesFirst,
  onToggleFavoritesFirst,
  platforms,
  selectedPlatforms,
  onPlatformsChange,
}: Readonly<SidebarFilterMenuProps>) {
  const { t } = useTranslation(["sidebar", "library"]);

  const tooltipId = useId();
  const pointerInteractionRef = useRef(false);

  const handlePlatformToggle = (platform: string, checked: boolean) => {
    if (checked) {
      if (selectedPlatforms.includes(platform)) return;
      onPlatformsChange([...selectedPlatforms, platform]);
      return;
    }

    if (selectedPlatforms.length <= 1) return;

    onPlatformsChange(
      selectedPlatforms.filter((selected) => selected !== platform)
    );
  };

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

          {category === "classics" && (
            <>
              <div className="sidebar-filter-menu__divider" />

              <div className="sidebar-filter-menu__column">
                <DropdownMenuPrimitive.Group className="sidebar-filter-menu__group">
                  <DropdownMenuPrimitive.Label className="sidebar-filter-menu__label">
                    {t("consoles_label")}
                  </DropdownMenuPrimitive.Label>

                  <DropdownMenuPrimitive.CheckboxItem
                    checked={selectedPlatforms.length === 0}
                    onCheckedChange={(checked) => {
                      if (checked === true) onPlatformsChange([]);
                    }}
                    onSelect={(event) => event.preventDefault()}
                    className="sidebar-filter-menu__item"
                  >
                    <span className="sidebar-filter-menu__item-label">
                      {t("all_consoles", { ns: "library" })}
                    </span>
                    <DropdownMenuPrimitive.ItemIndicator
                      forceMount
                      className="sidebar-filter-menu__item-indicator"
                    >
                      <CheckIcon size={14} />
                    </DropdownMenuPrimitive.ItemIndicator>
                  </DropdownMenuPrimitive.CheckboxItem>

                  {platforms.map((platform) => (
                    <DropdownMenuPrimitive.CheckboxItem
                      key={platform}
                      checked={selectedPlatforms.includes(platform)}
                      onCheckedChange={(checked) =>
                        handlePlatformToggle(platform, checked === true)
                      }
                      onSelect={(event) => event.preventDefault()}
                      className="sidebar-filter-menu__item"
                    >
                      <span className="sidebar-filter-menu__item-label">
                        {platform}
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
              </div>
            </>
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
