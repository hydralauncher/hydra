import {
  CheckCircleIcon,
  EyeClosedIcon,
  LockIcon,
  MagnifyingGlassIcon,
  MedalIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import type { UserAchievement } from "@types";
import { formatAchievementUnlockPercentage } from "@shared";
import cn from "classnames";
import { useTranslation } from "react-i18next";
import { useDate } from "../../../../hooks";
import { FocusItem, Tooltip, Typography } from "../../../common";
import type { FocusOverrides } from "../../../../services";
import { getAchievementRowId } from "../navigation";

export interface AchievementRowProps {
  achievement: UserAchievement;
  concealed?: boolean;
  revealed?: boolean;
  showPoints?: boolean;
  stealFocusOnAppear?: boolean;
  navigationOverrides?: FocusOverrides;
  onSouvenirActivate?: (achievement: UserAchievement) => void;
  onReveal?: (achievement: UserAchievement) => void;
}

export function AchievementRow({
  achievement,
  concealed = false,
  revealed = false,
  showPoints = false,
  stealFocusOnAppear = false,
  navigationOverrides,
  onSouvenirActivate,
  onReveal,
}: Readonly<AchievementRowProps>) {
  const { t, i18n } = useTranslation("achievement");
  const { formatDate, formatTime } = useDate();
  const unlockedAt =
    achievement.unlockTime != null
      ? `${formatDate(achievement.unlockTime)} · ${formatTime(achievement.unlockTime)}`
      : undefined;
  const hasSouvenir = Boolean(achievement.unlocked && achievement.imageUrl);
  const canViewSouvenir = hasSouvenir && onSouvenirActivate !== undefined;
  const canReveal = concealed && onReveal !== undefined;
  const unlockPercentage =
    achievement.globalUnlockPercentage != null
      ? formatAchievementUnlockPercentage(
          achievement.globalUnlockPercentage,
          i18n.language
        )
      : null;

  const getPrimaryAction = () => {
    if (canReveal) return () => onReveal(achievement);
    if (canViewSouvenir) return () => onSouvenirActivate(achievement);
    return "off" as const;
  };

  return (
    <FocusItem
      id={getAchievementRowId(achievement.name)}
      actions={{ primary: getPrimaryAction() }}
      navigationOverrides={navigationOverrides}
      stealFocusOnAppear={stealFocusOnAppear}
      asChild
    >
      <li
        className={cn("game-achievements-row", {
          "game-achievements-row--unlocked": achievement.unlocked,
          "game-achievements-row--concealed": concealed,
          "game-achievements-row--revealed": revealed,
        })}
      >
        {concealed ? (
          <span className="game-achievements-row__icon game-achievements-row__icon--concealed">
            <EyeClosedIcon size={28} />
          </span>
        ) : (
          <img
            src={achievement.icon}
            width={56}
            height={56}
            alt={achievement.displayName}
            loading="lazy"
            className={cn("game-achievements-row__icon", {
              "game-achievements-row__icon--locked": !achievement.unlocked,
            })}
          />
        )}

        <div className="game-achievements-row__info">
          <Typography className="game-achievements-row__title">
            {concealed ? (
              t("hidden_achievement")
            ) : (
              <>
                {achievement.hidden && !achievement.unlocked ? (
                  <EyeClosedIcon
                    size={16}
                    className="game-achievements-row__hidden-icon"
                  />
                ) : null}
                {achievement.displayName}
                {achievement.hardcoreUnlockTime != null ? (
                  <span className="game-achievements-row__hardcore-badge">
                    {t("hardcore")}
                  </span>
                ) : null}
              </>
            )}
          </Typography>

          {concealed ? (
            <Typography className="game-achievements-row__hidden-note">
              {t("select_to_reveal")}
            </Typography>
          ) : achievement.description ? (
            <Typography className="game-achievements-row__description">
              {achievement.description}
            </Typography>
          ) : null}

          {!concealed && unlockedAt ? (
            <Typography className="game-achievements-row__unlock-time">
              {t("unlocked_at", { date: unlockedAt })}
            </Typography>
          ) : null}
        </div>

        <div className="game-achievements-row__meta">
          {hasSouvenir ? (
            <span className="game-achievements-row__souvenir">
              <img
                src={achievement.imageUrl!}
                alt={t("souvenir_alt", {
                  achievement: achievement.displayName,
                })}
                loading="lazy"
                className="game-achievements-row__souvenir-image"
              />

              {canViewSouvenir ? (
                <>
                  <span className="game-achievements-row__souvenir-overlay">
                    <MagnifyingGlassIcon size={20} />
                  </span>

                  <button
                    type="button"
                    className="game-achievements-row__souvenir-button"
                    onClick={() => onSouvenirActivate(achievement)}
                    aria-label={t("view_souvenir")}
                    tabIndex={-1}
                  />
                </>
              ) : null}
            </span>
          ) : null}

          {unlockPercentage || (showPoints && achievement.points != null) ? (
            <div className="game-achievements-row__stats">
              {unlockPercentage ? (
                <span
                  className="game-achievements-row__percentage"
                  title={t("unlock_percentage_tooltip", {
                    percentage: unlockPercentage,
                  })}
                >
                  <UsersIcon size={16} weight="fill" />
                  <span>{unlockPercentage}</span>
                </span>
              ) : null}

              {showPoints && achievement.points != null ? (
                <div
                  className="game-achievements-row__points"
                  title={t("achievement_earn_points", {
                    points: achievement.points,
                  })}
                >
                  <MedalIcon size={16} weight="fill" />
                  <span>{achievement.points}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="game-achievements-row__status">
            {achievement.unlocked ? (
              <Tooltip
                content={unlockedAt ?? ""}
                position="left"
                active={unlockedAt != undefined}
              >
                <CheckCircleIcon size={28} weight="fill" />
              </Tooltip>
            ) : (
              <LockIcon size={24} />
            )}
          </div>
        </div>
      </li>
    </FocusItem>
  );
}
