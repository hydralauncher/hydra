import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon } from "@primer/octicons-react";
import cn from "classnames";
import type { AchievementSet } from "@types";
import { formatDownloadProgress, isGameCompleted } from "@renderer/helpers";
import { ProgressBar } from "@renderer/components";

export function useAchievementSetName() {
  const { t } = useTranslation("achievement");

  return (set: AchievementSet | null) => {
    if (!set) return t("achievement_set_other");
    return set.name ?? t("achievement_set_base_game");
  };
}

interface AchievementSetHeaderProps {
  set: AchievementSet | null;
  expanded: boolean;
  onToggle: () => void;
  unlockedCount: number;
  totalCount: number;
}

export function AchievementSetHeader({
  set,
  expanded,
  onToggle,
  unlockedCount,
  totalCount,
}: Readonly<AchievementSetHeaderProps>) {
  const { t } = useTranslation("achievement");
  const getSetName = useAchievementSetName();
  const completed = isGameCompleted(totalCount, unlockedCount);

  return (
    <button
      type="button"
      className="achievements__set-header"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <ChevronDownIcon
        size={16}
        className={cn("achievements__set-chevron", {
          "achievements__set-chevron--collapsed": !expanded,
        })}
      />
      <span className="achievements__set-name">{getSetName(set)}</span>

      <span className="achievements__set-progress">
        <span className="achievements__set-count">
          {unlockedCount} / {totalCount}
        </span>
        <ProgressBar
          now={unlockedCount}
          max={totalCount}
          label={t("achievement_progress", {
            unlockedCount,
            totalCount,
          })}
          completed={completed}
          trackClassName="achievements__set-progress-track"
          barClassName="achievements__set-progress-bar"
        />
        <span
          className={cn("achievements__set-percentage", {
            "achievements__set-percentage--completed": completed,
          })}
        >
          {formatDownloadProgress(
            totalCount > 0 ? unlockedCount / totalCount : 0
          )}
        </span>
      </span>
    </button>
  );
}

interface ComparedAchievementSetHeaderProps {
  set: AchievementSet | null;
  expanded: boolean;
  onToggle: () => void;
  style: CSSProperties;
  cells: ReactNode;
}

export function ComparedAchievementSetHeader({
  set,
  expanded,
  onToggle,
  style,
  cells,
}: Readonly<ComparedAchievementSetHeaderProps>) {
  const getSetName = useAchievementSetName();

  return (
    <button
      type="button"
      className="achievements__set-header achievements__set-header--compare"
      style={style}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="achievements__set-title">
        <ChevronDownIcon
          size={16}
          className={cn("achievements__set-chevron", {
            "achievements__set-chevron--collapsed": !expanded,
          })}
        />
        <span className="achievements__set-name">{getSetName(set)}</span>
      </span>
      {cells}
    </button>
  );
}
