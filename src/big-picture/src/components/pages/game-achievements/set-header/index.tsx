import { CaretDownIcon } from "@phosphor-icons/react";
import type { AchievementSet } from "@types";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import { FocusItem } from "../../../common";
import type { FocusOverrides } from "../../../../services";
import { getAchievementSetId } from "../navigation";
import type { VirtualRowProps } from "../achievement-row";

export interface AchievementSetHeaderProps {
  setKey: string;
  set: AchievementSet | null;
  expanded: boolean;
  unlockedCount: number;
  totalCount: number;
  navigationOrder?: number;
  navigationOverrides?: FocusOverrides;
  spaced?: boolean;
  virtualRow?: VirtualRowProps;
  onToggle: () => void;
}

const formatPercentage = (percentage: number) =>
  percentage === 0 || Number.isInteger(percentage)
    ? `${percentage}%`
    : `${percentage.toFixed(1)}%`;

export function AchievementSetHeader({
  setKey,
  set,
  expanded,
  unlockedCount,
  totalCount,
  navigationOrder,
  navigationOverrides,
  spaced = false,
  virtualRow,
  onToggle,
}: Readonly<AchievementSetHeaderProps>) {
  const { t } = useTranslation("achievement");
  const percentage = totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0;

  let name = t("achievement_set_other");
  if (set) name = set.name ?? t("achievement_set_base_game");

  return (
    <FocusItem
      id={getAchievementSetId(setKey)}
      actions={{ primary: onToggle }}
      navigationOrder={navigationOrder}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <li
        {...virtualRow}
        className={cn("game-achievements-set", {
          "game-achievements-set--collapsed": !expanded,
          "game-achievements-set--spaced": spaced,
        })}
      >
        <button
          type="button"
          className="game-achievements-set__button"
          aria-expanded={expanded}
          onClick={onToggle}
          tabIndex={-1}
        >
          <CaretDownIcon size={20} className="game-achievements-set__caret" />

          <span className="game-achievements-set__name">{name}</span>

          <span className="game-achievements-set__progress">
            <span className="game-achievements-set__count">
              {unlockedCount} / {totalCount}
            </span>

            <span className="game-achievements-set__bar">
              <span
                className="game-achievements-set__bar-fill"
                style={{ width: `${percentage}%` }}
              />
            </span>

            <span className="game-achievements-set__percentage">
              {formatPercentage(percentage)}
            </span>
          </span>
        </button>
      </li>
    </FocusItem>
  );
}
