import type { ComparedAchievements, UserAchievement } from "@types";
import "./achievements.scss";
import {
  CheckCircleFillIcon,
  ClockIcon,
  EyeClosedIcon,
  LockIcon,
  PeopleIcon,
  PersonIcon,
  SortAscIcon,
  SortDescIcon,
  TrophyIcon,
  UnlockIcon,
} from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { GlobeHemisphereWestIcon } from "@phosphor-icons/react";
import { useAppSelector } from "@renderer/hooks";
import { TextField } from "@renderer/components";
import {
  type CSSProperties,
  Fragment,
  useCallback,
  useMemo,
  useState,
} from "react";

import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  buildAchievementListEntries,
  filterAndSortAchievements,
  formatAchievementUnlockDateTime,
  formatAchievementUnlockPercentage,
  getAchievementComparisonCounts,
  getComparedTargetAchievements,
  getVisibleSetGroups,
  groupAchievementsBySet,
  isAchievementConcealed,
  matchesAchievementComparisonFilter,
  type AchievementComparisonFilter,
  type AchievementSortOption,
} from "@shared";
import {
  AchievementSelect,
  type AchievementSelectOption,
} from "./achievement-select";
import { ComparedAchievementSetHeader } from "./achievement-set-header";
import { AchievementIcon, AchievementIconPreload } from "./achievement-icon";
import { useVirtualAchievementList } from "./use-virtual-achievement-list";
import {
  useCollapsedAchievementSets,
  useRevealedAchievements,
} from "../../../../shared/use-achievement-list-state";

interface ComparedUser {
  displayName: string;
  profileImageUrl: string | null;
}

export interface ComparedAchievementListProps {
  achievements: ComparedAchievements;
  owner: ComparedUser;
  target: ComparedUser;
  scrollElement: HTMLElement | null;
}

type ComparedAchievement = ComparedAchievements["achievements"][number];

type ComparedRow = UserAchievement & {
  ownerUnlocked: boolean;
  targetUnlocked: boolean;
  achievement: ComparedAchievement;
};

function UserAvatar({
  user,
  size,
}: Readonly<{ user: ComparedUser; size: number }>) {
  return user.profileImageUrl ? (
    <img
      className="achievements__compare-avatar"
      src={user.profileImageUrl}
      alt={user.displayName}
      width={size}
      height={size}
    />
  ) : (
    <span
      className="achievements__compare-avatar achievements__compare-avatar--empty"
      style={{ width: size, height: size }}
    >
      <PersonIcon size={Math.round(size * 0.6)} />
    </span>
  );
}

export function ComparedAchievementList({
  achievements,
  owner,
  target,
  scrollElement,
}: Readonly<ComparedAchievementListProps>) {
  const { t, i18n } = useTranslation("achievement");
  const formatUnlockDateTime = (date: number) =>
    formatAchievementUnlockDateTime(date, i18n.language);
  const showHiddenAchievements = useAppSelector(
    (state) =>
      state.userPreferences.value?.showHiddenAchievementsDescription ?? false
  );

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AchievementComparisonFilter>("all");
  const [sort, setSort] = useState<AchievementSortOption>("most_common");
  const { revealedNames, lastRevealedName, revealAchievement } =
    useRevealedAchievements();
  const { collapsedSetKeys, toggleSet } = useCollapsedAchievementSets();

  const hasOwnerStats = achievements.achievements.some(
    (achievement) => achievement.ownerStat
  );

  const rows = useMemo<ComparedRow[]>(
    () =>
      getComparedTargetAchievements(achievements).map((row, index) => {
        const achievement = achievements.achievements[index];

        return {
          ...row,
          ownerUnlocked: Boolean(achievement.ownerStat?.unlocked),
          targetUnlocked: row.unlocked,
          achievement,
        };
      }),
    [achievements]
  );

  const isConcealed = useCallback(
    (row: Pick<ComparedRow, "name" | "hidden" | "ownerUnlocked">) =>
      isAchievementConcealed(
        { hidden: row.hidden, unlocked: row.ownerUnlocked },
        showHiddenAchievements
      ) && !revealedNames.has(row.name),
    [revealedNames, showHiddenAchievements]
  );

  const filterCounts = useMemo(
    () => getAchievementComparisonCounts(rows),
    [rows]
  );

  const visibleRows = useMemo(
    () =>
      filterAndSortAchievements(
        rows.filter((row) => matchesAchievementComparisonFilter(row, filter)),
        { search, status: "all", sort, isConcealed }
      ),
    [filter, isConcealed, rows, search, sort]
  );

  const setGroups = useMemo(() => groupAchievementsBySet(rows), [rows]);

  const visibleSetGroups = useMemo(
    () => (setGroups ? getVisibleSetGroups(setGroups, visibleRows) : null),
    [setGroups, visibleRows]
  );

  const ownerUnlockedCountBySet = useMemo(
    () =>
      new Map(
        (setGroups ?? []).map((group) => [
          group.key,
          group.achievements.filter((row) => row.ownerUnlocked).length,
        ])
      ),
    [setGroups]
  );
  const sortOptions: AchievementSelectOption<AchievementSortOption>[] = [
    {
      value: "most_common",
      label: t("sort_most_common"),
      icon: <SortDescIcon size={16} />,
    },
    {
      value: "most_rare",
      label: t("sort_most_rare"),
      icon: <SortAscIcon size={16} />,
    },
    {
      value: "recently_unlocked",
      label: t("sort_recently_unlocked"),
      icon: <ClockIcon size={16} />,
    },
  ];

  const personOption = (
    value: "owner" | "target",
    user: ComparedUser
  ): AchievementSelectOption<AchievementComparisonFilter> => ({
    value,
    label: user.displayName,
    icon: <UserAvatar user={user} size={16} />,
    count: filterCounts[value],
  });

  const filterOptions: AchievementSelectOption<AchievementComparisonFilter>[] =
    [
      {
        value: "all",
        label: t("all_achievements"),
        icon: <TrophyIcon size={16} />,
        count: filterCounts.all,
      },
      ...(hasOwnerStats
        ? [
            {
              value: "both" as const,
              label: t("compare_filter_both"),
              icon: <UnlockIcon size={16} />,
              count: filterCounts.both,
            },
          ]
        : []),
      {
        value: "neither",
        label: t("compare_filter_neither"),
        icon: <LockIcon size={16} />,
        count: filterCounts.neither,
      },
      ...(hasOwnerStats ? [personOption("owner", owner)] : []),
      personOption("target", target),
    ];

  const renderStatus = (
    stat: ComparedAchievement["targetStat"] | undefined,
    user: ComparedUser
  ) =>
    stat?.unlocked ? (
      <div
        className="achievements__compare-status achievements__compare-status--unlocked"
        title={t("compare_unlocked_by", {
          name: user.displayName,
          date: formatUnlockDateTime(stat.unlockTime),
        })}
      >
        <CheckCircleFillIcon size={18} />
        <small>{formatUnlockDateTime(stat.unlockTime)}</small>
      </div>
    ) : (
      <div
        className="achievements__compare-status"
        title={t("compare_locked_for", { name: user.displayName })}
      >
        <LockIcon size={18} />
      </div>
    );

  const hasCommunityStats = rows.some(
    (row) => row.points != null || row.globalUnlockPercentage != null
  );

  const statColumnCount = 1 + Number(hasOwnerStats) + Number(hasCommunityStats);
  const gridStyle = {
    "--compare-stat-columns": statColumnCount,
  } as CSSProperties;

  const entries = buildAchievementListEntries(
    visibleSetGroups,
    visibleRows,
    collapsedSetKeys
  );

  const { listRef, virtualizer, getRowProps } = useVirtualAchievementList({
    count: entries.length,
    scrollElement,
    getItemKey: (index) => {
      const entry = entries[index];
      return entry.type === "set"
        ? `set-${entry.group.key}`
        : entry.achievement.name;
    },
    isSetHeader: (index) => entries[index]?.type === "set",
  });

  const renderRow = (
    row: ComparedRow,
    rowProps: ReturnType<typeof getRowProps>
  ) => {
    const concealed = isConcealed(row);
    const { achievement } = row;
    const unlockedByAnyone = row.ownerUnlocked || row.targetUnlocked;

    return (
      <li
        {...rowProps}
        style={{ ...gridStyle, ...rowProps.style }}
        className={cn("achievements__item achievements__compare-row", {
          "achievements__item--unlocked": unlockedByAnyone,
          "achievements__item--concealed": concealed,
          "achievements__item--revealed": row.name === lastRevealedName,
        })}
      >
        {concealed ? (
          <button
            type="button"
            className="achievements__item-reveal"
            onClick={() => revealAchievement(row.name)}
          >
            <span className="achievements__item-icon achievements__item-icon--concealed">
              <EyeClosedIcon size={24} />
              <AchievementIconPreload src={achievement.icon} />
            </span>

            <span className="achievements__item-content">
              <span className="achievements__item-title">
                {t("hidden_achievement")}
              </span>
              <span className="achievements__item-description">
                {t("click_to_reveal")}
              </span>
            </span>
          </button>
        ) : (
          <div className="achievements__compare-main">
            <div className="achievements__item-icon">
              <AchievementIcon
                src={achievement.icon}
                alt={achievement.displayName}
                locked={!unlockedByAnyone}
              />
            </div>

            <div className="achievements__item-content">
              <h4 className="achievements__item-title">
                {achievement.hidden && !row.ownerUnlocked && (
                  <span
                    className="achievements__item-hidden-icon"
                    title={t("hidden_achievement_tooltip")}
                  >
                    <EyeClosedIcon size={12} />
                  </span>
                )}
                {achievement.displayName}
              </h4>

              {achievement.description && (
                <p className="achievements__item-description">
                  {achievement.description}
                </p>
              )}
            </div>
          </div>
        )}

        {hasCommunityStats && (
          <div className="achievements__compare-cell">
            <div className="achievements__item-stats">
              {achievement.globalUnlockPercentage != null && (
                <span
                  className="achievements__item-percentage"
                  title={t("unlock_percentage_tooltip", {
                    percentage: formatAchievementUnlockPercentage(
                      achievement.globalUnlockPercentage,
                      i18n.language
                    ),
                  })}
                >
                  <PeopleIcon size={16} />
                  <span>
                    {formatAchievementUnlockPercentage(
                      achievement.globalUnlockPercentage,
                      i18n.language
                    )}
                  </span>
                </span>
              )}

              {achievement.points != null && (
                <div
                  className="achievements__item-points"
                  title={t("achievement_earn_points", {
                    points: achievement.points,
                  })}
                >
                  <HydraIcon className="achievements__item-points-icon" />
                  <span className="achievements__item-points-value">
                    {achievement.points}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {hasOwnerStats && renderStatus(achievement.ownerStat, owner)}
        {renderStatus(achievement.targetStat, target)}
      </li>
    );
  };

  return (
    <div
      className={cn(
        "achievements__list-container achievements__list-container--compare",
        `achievements__list-container--stats-${statColumnCount}`
      )}
    >
      <div className="achievements__compare-sticky">
        <div className="achievements__compare-grid" style={gridStyle}>
          <div className="achievements__compare-controls">
            <div className="achievements__toolbar-search">
              <TextField
                theme="dark"
                value={search}
                placeholder={t("search_achievements")}
                aria-label={t("search_achievements")}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="achievements__compare-selects">
              <AchievementSelect
                value={filter}
                options={filterOptions}
                onChange={setFilter}
                ariaLabel={t("filter_achievements")}
              />

              <AchievementSelect
                value={sort}
                options={sortOptions}
                onChange={setSort}
                ariaLabel={t("sort_achievements")}
                fitToOptions
              />
            </div>
          </div>

          {hasCommunityStats && (
            <div
              className="achievements__compare-cell"
              title={t("global_stats")}
            >
              <span className="achievements__compare-global-badge">
                <GlobeHemisphereWestIcon size={26} weight="duotone" />
              </span>
            </div>
          )}
          {hasOwnerStats && (
            <div
              className="achievements__compare-cell"
              title={owner.displayName}
            >
              <UserAvatar user={owner} size={40} />
            </div>
          )}
          <div
            className="achievements__compare-cell"
            title={target.displayName}
          >
            <UserAvatar user={target} size={40} />
          </div>
        </div>

        <div
          className="achievements__compare-grid achievements__compare-grid--points"
          style={gridStyle}
        >
          <div className="achievements__compare-controls">
            <span className="achievements__compare-row-label">
              <HydraIcon className="achievements__toolbar-points-icon" />
              {t("hydra_points")}
            </span>
          </div>

          {hasCommunityStats && (
            <div
              className="achievements__compare-cell achievements__compare-points"
              title={t("available_points")}
            >
              <HydraIcon className="achievements__item-points-icon" />
              <span>{achievements.achievementsPointsTotal}</span>
            </div>
          )}
          {hasOwnerStats && (
            <div className="achievements__compare-cell achievements__compare-points">
              <HydraIcon className="achievements__item-points-icon" />
              <span>{achievements.owner.achievementsPointsEarnedSum ?? 0}</span>
            </div>
          )}
          <div className="achievements__compare-cell achievements__compare-points">
            <HydraIcon className="achievements__item-points-icon" />
            <span>{achievements.target.achievementsPointsEarnedSum}</span>
          </div>
        </div>
      </div>

      {entries.length === 0 ? (
        <ul className="achievements__list">
          <li className="achievements__empty">{t("no_achievements_found")}</li>
        </ul>
      ) : (
        <ul
          ref={listRef}
          className="achievements__list achievements__list--virtual"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index];
            const rowProps = getRowProps(item.index, item.start);

            if (entry.type === "achievement") {
              return (
                <Fragment key={item.key}>
                  {renderRow(entry.achievement, rowProps)}
                </Fragment>
              );
            }

            const { group } = entry;

            return (
              <li
                key={item.key}
                {...rowProps}
                className={cn("achievements__set", {
                  "achievements__set--spaced": item.index > 0,
                })}
              >
                <ComparedAchievementSetHeader
                  set={group.set}
                  expanded={entry.expanded}
                  onToggle={() => toggleSet(group.key)}
                  style={gridStyle}
                  cells={
                    <>
                      {hasCommunityStats && (
                        <span className="achievements__compare-cell" />
                      )}
                      {hasOwnerStats && (
                        <span className="achievements__compare-cell achievements__set-count">
                          {ownerUnlockedCountBySet.get(group.key) ?? 0} /{" "}
                          {group.totalCount}
                        </span>
                      )}
                      <span className="achievements__compare-cell achievements__set-count">
                        {group.unlockedCount} / {group.totalCount}
                      </span>
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
