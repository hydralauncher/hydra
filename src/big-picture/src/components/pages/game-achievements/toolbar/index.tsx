import {
  ClockIcon,
  LockIcon,
  LockOpenIcon,
  MagnifyingGlassIcon,
  MedalIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import type { AchievementSortOption, AchievementStatusFilter } from "@shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownSelect,
  type DropdownSelectOption,
  HorizontalFocusGroup,
  Input,
} from "../../../common";
import type { FocusOverrideTarget } from "../../../../services";
import {
  GAME_ACHIEVEMENTS_SEARCH_INPUT_ID,
  GAME_ACHIEVEMENTS_SORT_SELECT_ID,
  GAME_ACHIEVEMENTS_STATUS_SELECT_ID,
  GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID,
  GAME_ACHIEVEMENTS_TOOLBAR_REGION_ID,
} from "../navigation";

const STATUS_ICONS: Record<AchievementStatusFilter, JSX.Element> = {
  all: <TrophyIcon size={22} />,
  unlocked: <LockOpenIcon size={22} />,
  locked: <LockIcon size={22} />,
};

const SORT_ICONS: Record<AchievementSortOption, JSX.Element> = {
  most_common: <SortDescendingIcon size={22} />,
  most_rare: <SortAscendingIcon size={22} />,
  recently_unlocked: <ClockIcon size={22} />,
};

export interface GameAchievementsToolbarProps {
  search: string;
  onSearchChange: (search: string) => void;
  sort: AchievementSortOption;
  onSortChange: (sort: AchievementSortOption) => void;
  status: AchievementStatusFilter;
  onStatusChange: (status: AchievementStatusFilter) => void;
  statusCounts: Record<AchievementStatusFilter, number>;
  firstAchievementRowId: string | null;
  points: { earned: number; total: number } | null;
}

export function GameAchievementsToolbar({
  search,
  onSearchChange,
  sort,
  onSortChange,
  status,
  onStatusChange,
  statusCounts,
  firstAchievementRowId,
  points,
}: Readonly<GameAchievementsToolbarProps>) {
  const { t, i18n } = useTranslation("achievement");
  const numberFormatter = new Intl.NumberFormat(i18n.language);

  const sortOptions = useMemo(
    () =>
      [
        { value: "most_common", label: t("sort_most_common") },
        { value: "most_rare", label: t("sort_most_rare") },
        { value: "recently_unlocked", label: t("sort_recently_unlocked") },
      ] satisfies Array<DropdownSelectOption<AchievementSortOption>>,
    [t]
  );

  const statusOptions = useMemo(
    () =>
      (["all", "unlocked", "locked"] as const).map((filter) => ({
        value: filter,
        label: t(`filter_${filter}`, { count: statusCounts[filter] }),
      })) satisfies Array<DropdownSelectOption<AchievementStatusFilter>>,
    [statusCounts, t]
  );

  const upOverride: FocusOverrideTarget = {
    type: "item",
    itemId: GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID,
  };
  const downOverride: FocusOverrideTarget = firstAchievementRowId
    ? { type: "item", itemId: firstAchievementRowId }
    : { type: "block" };

  return (
    <div className="game-achievements-page__toolbar">
      <HorizontalFocusGroup
        className="game-achievements-page__toolbar-controls"
        regionId={GAME_ACHIEVEMENTS_TOOLBAR_REGION_ID}
      >
        <div className="game-achievements-page__toolbar-search">
          <Input
            focusId={GAME_ACHIEVEMENTS_SEARCH_INPUT_ID}
            focusNavigationOverrides={{
              left: { type: "block" },
              right: {
                type: "item",
                itemId: GAME_ACHIEVEMENTS_STATUS_SELECT_ID,
              },
              up: upOverride,
              down: downOverride,
            }}
            type="text"
            placeholder={t("search_achievements")}
            iconLeft={<MagnifyingGlassIcon size={24} />}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <DropdownSelect
          className="game-achievements-page__toolbar-select"
          hideLabel
          leadingIcon={STATUS_ICONS[status]}
          ariaLabel={t("filter_achievements")}
          focusId={GAME_ACHIEVEMENTS_STATUS_SELECT_ID}
          focusNavigationOverrides={{
            left: { type: "item", itemId: GAME_ACHIEVEMENTS_SEARCH_INPUT_ID },
            right: { type: "item", itemId: GAME_ACHIEVEMENTS_SORT_SELECT_ID },
            up: upOverride,
            down: downOverride,
          }}
          value={status}
          options={statusOptions}
          onValueChange={onStatusChange}
        />

        <DropdownSelect
          className="game-achievements-page__toolbar-select"
          hideLabel
          leadingIcon={SORT_ICONS[sort]}
          ariaLabel={t("sort_achievements")}
          focusId={GAME_ACHIEVEMENTS_SORT_SELECT_ID}
          focusNavigationOverrides={{
            left: { type: "item", itemId: GAME_ACHIEVEMENTS_STATUS_SELECT_ID },
            right: { type: "block" },
            up: upOverride,
            down: downOverride,
          }}
          value={sort}
          options={sortOptions}
          onValueChange={onSortChange}
        />

        <div className="game-achievements-page__toolbar-points">
          <span className="game-achievements-page__toolbar-points-label">
            {t("earned_points")}
          </span>
          <MedalIcon size={18} weight="fill" />
          {points ? (
            <span>
              {numberFormatter.format(points.earned)} /{" "}
              {numberFormatter.format(points.total)}
            </span>
          ) : (
            <span className="game-achievements-page__toolbar-points-locked">
              ??? / ???
            </span>
          )}
        </div>
      </HorizontalFocusGroup>
    </div>
  );
}
