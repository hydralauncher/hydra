import {
  CheckCircleIcon,
  EyeClosedIcon,
  LockIcon,
  MagnifyingGlassIcon,
  MedalIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import type { UserAchievement } from "@types";
import {
  formatAchievementUnlockDateTime,
  formatAchievementUnlockPercentage,
  getAchievementKey,
} from "@shared";
import cn from "classnames";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { FocusItem, Tooltip, Typography } from "../../../common";
import type { FocusOverrides } from "../../../../services";
import { getAchievementRowId } from "../navigation";

export interface AchievementRowProps {
  achievement: UserAchievement;
  concealed?: boolean;
  revealed?: boolean;
  showPoints?: boolean;
  stealFocusOnAppear?: boolean;
  navigationOrder?: number;
  navigationOverrides?: FocusOverrides;
  onSouvenirActivate?: (achievement: UserAchievement) => void;
  onReveal?: (achievement: UserAchievement) => void;
  virtualRow?: VirtualRowProps;
}

export interface VirtualRowProps {
  "data-index": number;
  ref: (element: Element | null) => void;
  style: CSSProperties;
}

function AchievementRowIcon({
  achievement,
  concealed,
}: Readonly<{ achievement: UserAchievement; concealed: boolean }>) {
  if (concealed) {
    return (
      <span className="game-achievements-row__icon game-achievements-row__icon--concealed">
        <EyeClosedIcon size={28} />
        <img src={achievement.icon} alt="" aria-hidden="true" hidden />
      </span>
    );
  }

  return (
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
  );
}

function AchievementRowTitle({
  achievement,
}: Readonly<{ achievement: UserAchievement }>) {
  const { t } = useTranslation("achievement");

  return (
    <Typography className="game-achievements-row__title">
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
    </Typography>
  );
}

function AchievementRowInfo({
  achievement,
  concealed,
  unlockedAt,
}: Readonly<{
  achievement: UserAchievement;
  concealed: boolean;
  unlockedAt?: string;
}>) {
  const { t } = useTranslation("achievement");

  if (concealed) {
    return (
      <div className="game-achievements-row__info">
        <Typography className="game-achievements-row__title">
          {t("hidden_achievement")}
        </Typography>
        <Typography className="game-achievements-row__hidden-note">
          {t("select_to_reveal")}
        </Typography>
      </div>
    );
  }

  return (
    <div className="game-achievements-row__info">
      <AchievementRowTitle achievement={achievement} />

      {achievement.description ? (
        <Typography className="game-achievements-row__description">
          {achievement.description}
        </Typography>
      ) : null}

      {unlockedAt ? (
        <Typography className="game-achievements-row__unlock-time">
          {t("unlocked_at", { date: unlockedAt })}
        </Typography>
      ) : null}
    </div>
  );
}

function AchievementRowSouvenir({
  achievement,
  onActivate,
}: Readonly<{
  achievement: UserAchievement;
  onActivate?: (achievement: UserAchievement) => void;
}>) {
  const { t } = useTranslation("achievement");

  return (
    <span className="game-achievements-row__souvenir">
      <img
        src={achievement.imageUrl!}
        alt={t("souvenir_alt", { achievement: achievement.displayName })}
        loading="lazy"
        className="game-achievements-row__souvenir-image"
      />

      {onActivate ? (
        <>
          <span className="game-achievements-row__souvenir-overlay">
            <MagnifyingGlassIcon size={20} />
          </span>

          <button
            type="button"
            className="game-achievements-row__souvenir-button"
            onClick={() => onActivate(achievement)}
            aria-label={t("view_souvenir")}
            tabIndex={-1}
          />
        </>
      ) : null}
    </span>
  );
}

function AchievementRowStats({
  achievement,
  showPoints,
}: Readonly<{ achievement: UserAchievement; showPoints: boolean }>) {
  const { t, i18n } = useTranslation("achievement");
  const unlockPercentage =
    achievement.globalUnlockPercentage == null
      ? null
      : formatAchievementUnlockPercentage(
          achievement.globalUnlockPercentage,
          i18n.language
        );
  const points = showPoints ? achievement.points : undefined;

  if (!unlockPercentage && points == null) return null;

  return (
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

      {points == null ? null : (
        <div
          className="game-achievements-row__points"
          title={t("achievement_earn_points", { points })}
        >
          <MedalIcon size={16} weight="fill" />
          <span>{points}</span>
        </div>
      )}
    </div>
  );
}

function AchievementRowStatus({
  unlocked,
  unlockedAt,
}: Readonly<{ unlocked: boolean; unlockedAt?: string }>) {
  return (
    <div className="game-achievements-row__status">
      {unlocked ? (
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
  );
}

export function AchievementRow({
  achievement,
  concealed = false,
  revealed = false,
  showPoints = false,
  stealFocusOnAppear = false,
  navigationOrder,
  navigationOverrides,
  onSouvenirActivate,
  onReveal,
  virtualRow,
}: Readonly<AchievementRowProps>) {
  const { t, i18n } = useTranslation("achievement");
  const unlockedAt =
    achievement.unlockTime == null
      ? undefined
      : formatAchievementUnlockDateTime(achievement.unlockTime, i18n.language);
  const hasSouvenir = Boolean(achievement.unlocked && achievement.imageUrl);
  const revealAchievement =
    concealed && onReveal ? () => onReveal(achievement) : undefined;
  const viewSouvenir =
    hasSouvenir && onSouvenirActivate
      ? () => onSouvenirActivate(achievement)
      : undefined;

  return (
    <FocusItem
      id={getAchievementRowId(getAchievementKey(achievement))}
      actions={{ primary: revealAchievement ?? viewSouvenir ?? "off" }}
      navigationOrder={navigationOrder}
      navigationOverrides={navigationOverrides}
      stealFocusOnAppear={stealFocusOnAppear}
      asChild
    >
      <li
        {...virtualRow}
        className={cn("game-achievements-row", {
          "game-achievements-row--unlocked": achievement.unlocked,
          "game-achievements-row--concealed": concealed,
          "game-achievements-row--revealed": revealed,
        })}
      >
        <AchievementRowIcon achievement={achievement} concealed={concealed} />

        <AchievementRowInfo
          achievement={achievement}
          concealed={concealed}
          unlockedAt={unlockedAt}
        />

        <div className="game-achievements-row__meta">
          {hasSouvenir ? (
            <AchievementRowSouvenir
              achievement={achievement}
              onActivate={onSouvenirActivate}
            />
          ) : null}

          <AchievementRowStats
            achievement={achievement}
            showPoints={showPoints}
          />

          <AchievementRowStatus
            unlocked={achievement.unlocked}
            unlockedAt={unlockedAt}
          />
        </div>

        {revealAchievement ? (
          <button
            type="button"
            className="game-achievements-row__reveal-button"
            onClick={revealAchievement}
            aria-label={t("select_to_reveal")}
            tabIndex={-1}
          />
        ) : null}
      </li>
    </FocusItem>
  );
}
