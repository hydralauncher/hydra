import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  AppsIcon,
  CheckIcon,
  ChevronDownIcon,
  RowsIcon,
  SortDescIcon,
  SquareIcon,
  UndoIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useCloseOnLibraryScroll } from "./use-close-on-library-scroll";
import {
  LIBRARY_DROPDOWN_CHEVRON_SIZE,
  LIBRARY_DROPDOWN_COLLISION_PADDING,
  LIBRARY_DROPDOWN_SIDE_OFFSET,
} from "./library-dropdown";
import "./library-toolbar-menu.scss";

export type SortOption =
  | "title_asc"
  | "recently_played"
  | "most_played"
  | "achievements"
  | "installed_first"
  | "title_desc"
  | "custom";

export type ViewMode = "grid" | "compact" | "large";

interface LibraryDisplayMenuProps {
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
  viewMode: ViewMode;
  onViewModeChange: (viewMode: ViewMode) => void;
  canResetCustomOrder: boolean;
  onResetCustomOrder: () => void;
}

/** Sort order and card size, behind one button that names the current sort. */
export function LibraryDisplayMenu({
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  canResetCustomOrder,
  onResetCustomOrder,
}: Readonly<LibraryDisplayMenuProps>) {
  const { t } = useTranslation("library");
  const [open, setOpen] = useCloseOnLibraryScroll();

  const sortOptions: { value: SortOption; label: string }[] = [
    { value: "title_asc", label: t("sort_title_asc") },
    { value: "recently_played", label: t("recently_played") },
    { value: "most_played", label: t("sort_most_played") },
    { value: "achievements", label: t("sort_achievements") },
    { value: "installed_first", label: t("sort_installed_first") },
    { value: "title_desc", label: t("sort_title_desc") },
    { value: "custom", label: t("sort_custom") },
  ];

  const viewOptions: {
    value: ViewMode;
    label: string;
    icon: JSX.Element;
  }[] = [
    {
      value: "compact",
      label: t("view_compact"),
      icon: <SquareIcon size={16} />,
    },
    { value: "grid", label: t("view_grid"), icon: <AppsIcon size={16} /> },
    { value: "large", label: t("view_large"), icon: <RowsIcon size={16} /> },
  ];

  const currentSort = sortOptions.find((option) => option.value === sortBy);

  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className="library-toolbar-menu__trigger"
          aria-label={`${t("sort_by")}: ${currentSort?.label ?? ""}`}
        >
          <SortDescIcon size={16} />
          <span>{currentSort?.label}</span>
          <ChevronDownIcon
            size={LIBRARY_DROPDOWN_CHEVRON_SIZE}
            className="library-toolbar-menu__chevron"
          />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={LIBRARY_DROPDOWN_SIDE_OFFSET}
          collisionPadding={LIBRARY_DROPDOWN_COLLISION_PADDING}
          className="library-toolbar-menu__content"
        >
          <DropdownMenuPrimitive.Label className="library-toolbar-menu__label">
            {t("sort_by")}
          </DropdownMenuPrimitive.Label>
          <DropdownMenuPrimitive.RadioGroup
            value={sortBy}
            onValueChange={(value) => onSortChange(value as SortOption)}
          >
            {sortOptions.map((option) => (
              <DropdownMenuPrimitive.RadioItem
                key={option.value}
                value={option.value}
                className="library-toolbar-menu__item"
              >
                <span className="library-toolbar-menu__item-label">
                  {option.label}
                </span>
                <DropdownMenuPrimitive.ItemIndicator
                  forceMount
                  className="library-toolbar-menu__item-indicator"
                >
                  <CheckIcon size={14} />
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>

          {sortBy === "custom" && (
            <DropdownMenuPrimitive.Item
              className="library-toolbar-menu__item library-toolbar-menu__item--muted"
              disabled={!canResetCustomOrder}
              onSelect={onResetCustomOrder}
            >
              <UndoIcon size={14} />
              <span className="library-toolbar-menu__item-label">
                {t("reset_custom_order")}
              </span>
            </DropdownMenuPrimitive.Item>
          )}

          <DropdownMenuPrimitive.Separator className="library-toolbar-menu__separator" />

          <DropdownMenuPrimitive.Label className="library-toolbar-menu__label">
            {t("view_mode")}
          </DropdownMenuPrimitive.Label>
          <DropdownMenuPrimitive.RadioGroup
            value={viewMode}
            onValueChange={(value) => onViewModeChange(value as ViewMode)}
            className="library-toolbar-menu__views"
          >
            {viewOptions.map((option) => (
              <DropdownMenuPrimitive.RadioItem
                key={option.value}
                value={option.value}
                className="library-toolbar-menu__view"
              >
                {option.icon}
                {option.label}
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
