import type { ComparedAchievements } from "@types";
import "./achievements.scss";
import {
  CheckCircleFillIcon,
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
import { useAppSelector, useDate } from "@renderer/hooks";
import { TextField } from "@renderer/components";
import { type CSSProperties, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  filterAndSortAchievements,
  formatAchievementUnlockPercentage,
  getAchievementComparisonCounts,
  isAchievementConcealed,
  matchesAchievementComparisonFilter,
  type AchievementComparisonFilter,
  type AchievementSortOption,
} from "@shared";
import {
  AchievementSelect,
  type AchievementSelectOption,
} from "./achievement-select";

interface ComparedUser {
  displayName: string;
  profileImageUrl: string | null;
}

export interface ComparedAchievementListProps {
  achievements: ComparedAchievements;
  owner: ComparedUser;
  target: ComparedUser;
}

type ComparedAchievement = ComparedAchievements["achievements"][number];

interface ComparedRow {
  name: string;
  displayName: string;
  description: string;
  hidden: boolean;
  unlocked: boolean;
  points?: number;
  globalUnlockPercentage?: number | null;
  ownerUnlocked: boolean;
  targetUnlocked: boolean;
  achievement: ComparedAchievement;
}

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
}: Readonly<ComparedAchievementListProps>) {
  const { t, i18n } = useTranslation("achievement");
  const { formatUnlockDateTime } = useDate();
  const showHiddenAchievements = useAppSelector(
    (state) =>
      state.userPreferences.value?.showHiddenAchievementsDescription ?? false
  );

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AchievementComparisonFilter>("all");
  const [sort, setSort] = useState<AchievementSortOption>("most_common");
  const [revealedNames, setRevealedNames] = useState<Set<string>>(
    () => new Set()
  );
  const [lastRevealedName, setLastRevealedName] = useState<string | null>(null);

  const hasOwnerStats = achievements.achievements.some(
    (achievement) => achievement.ownerStat
  );

  const rows = useMemo<ComparedRow[]>(
    () =>
      achievements.achievements.map((achievement, index) => ({
        name: String(index),
        displayName: achievement.displayName,
        description: achievement.description,
        hidden: achievement.hidden,
        unlocked: achievement.targetStat.unlocked,
        points: achievement.points,
        globalUnlockPercentage: achievement.globalUnlockPercentage,
        ownerUnlocked: Boolean(achievement.ownerStat?.unlocked),
        targetUnlocked: achievement.targetStat.unlocked,
        achievement,
      })),
    [achievements]
  );

  const ownerUnlockedByName = useMemo(
    () => new Map(rows.map((row) => [row.name, row.ownerUnlocked])),
    [rows]
  );

  const isConcealed = useCallback(
    (row: Pick<ComparedRow, "name" | "hidden">) =>
      isAchievementConcealed(
        {
          hidden: row.hidden,
          unlocked: ownerUnlockedByName.get(row.name) ?? false,
        },
        showHiddenAchievements
      ) && !revealedNames.has(row.name),
    [ownerUnlockedByName, revealedNames, showHiddenAchievements]
  );

  const revealAchievement = (name: string) => {
    setRevealedNames((current) => new Set(current).add(name));
    setLastRevealedName(name);
  };

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
              label: t("unlocked"),
              icon: <UnlockIcon size={16} />,
              count: filterCounts.both,
            },
          ]
        : []),
      {
        value: "neither",
        label: t("locked"),
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

      <ul className="achievements__list">
        {visibleRows.length === 0 && (
          <li className="achievements__empty">{t("no_achievements_found")}</li>
        )}

        {visibleRows.map((row) => {
          const concealed = isConcealed(row);
          const { achievement } = row;
          const unlockedByAnyone = row.ownerUnlocked || row.targetUnlocked;

          return (
            <li
              key={row.name}
              style={gridStyle}
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
                    <img
                      className={cn("achievements__item-image", {
                        "achievements__item-image--locked": !unlockedByAnyone,
                      })}
                      src={achievement.icon}
                      alt={achievement.displayName}
                      loading="lazy"
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
        })}
      </ul>
    </div>
  );
}
