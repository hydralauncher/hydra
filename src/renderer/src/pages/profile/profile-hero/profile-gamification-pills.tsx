import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import cn from "classnames";
import {
  CoinIcon,
  FlameIcon,
  STREAK_EMBERS_DAYS,
  STREAK_FIRE_DAYS,
  STREAK_HOT_DAYS,
  StreakFire,
  XpBar,
  getFirePalette,
  useAnimatedNumber,
  useHoverHalo,
} from "@renderer/components/gamification";
import { useFormat } from "@renderer/hooks";
import type { LevelProgress, LoginStreak } from "@types";
import { openProfileTab } from "../profile-tab-events";
import { useProfileGamification } from "../use-profile-gamification";
import "./profile-gamification-pills.scss";

const LEVEL_PILL_HALO_ALPHA = 0.07;

/** The profile hero pills, fed by the viewed profile. */
export function ProfileGamificationPills() {
  const navigate = useNavigate();
  const { level, loginStreak, coins, isMe } = useProfileGamification();

  if (!level) return null;

  return (
    <GamificationPills
      level={level}
      loginStreak={loginStreak}
      coins={coins}
      onLevelClick={isMe ? () => openProfileTab("missions") : undefined}
      onCoinsClick={() => navigate("/shop")}
    />
  );
}

interface GamificationPillsProps {
  level: LevelProgress;
  loginStreak?: LoginStreak | null;
  coins?: number | null;
  onLevelClick?: () => void;
  onCoinsClick?: () => void;
}

/** Level, streak and coins pills. Pills without data are left out. */
export function GamificationPills({
  level,
  loginStreak = null,
  coins = null,
  onLevelClick,
  onCoinsClick,
}: Readonly<GamificationPillsProps>) {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const halo = useHoverHalo<HTMLDivElement>(LEVEL_PILL_HALO_ALPHA);
  const shownCoins = useAnimatedNumber(coins ?? 0);

  const streakDays = loginStreak?.current ?? 0;
  const coinsContent = (
    <>
      <CoinIcon />
      <span>
        <strong>{formatNumber(shownCoins)}</strong>{" "}
        {t("coins_label", { count: coins ?? 0 })}
      </span>
    </>
  );

  return (
    <div className="profile-gamification-pills">
      <div
        ref={halo.hostRef}
        className={cn(
          "profile-gamification-pills__pill",
          "profile-gamification-pills__pill--level",
          { "profile-gamification-pills__pill--clickable": onLevelClick }
        )}
        role={onLevelClick ? "button" : undefined}
        tabIndex={onLevelClick ? 0 : undefined}
        onClick={onLevelClick}
        onKeyDown={
          onLevelClick
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onLevelClick();
                }
              }
            : undefined
        }
        {...halo.handlers}
      >
        <strong>{t("level_number", { level: level.level })}</strong>
        <XpBar
          xp={level.xp}
          xpToNextLevel={level.xpToNextLevel}
          trail={halo.intensity}
          className="profile-gamification-pills__bar"
        />
        <span>
          {level.xpToNextLevel === null
            ? t("max_level")
            : t("xp_progress", {
                xp: formatNumber(level.xp),
                total: formatNumber(level.xpToNextLevel),
              })}
        </span>
        <canvas
          ref={halo.canvasRef}
          className="profile-gamification-pills__halo"
          aria-hidden="true"
        />
      </div>

      {loginStreak && (
        <div
          className={cn(
            "profile-gamification-pills__pill",
            "profile-gamification-pills__pill--streak",
            {
              "profile-gamification-pills__pill--lit":
                streakDays >= STREAK_FIRE_DAYS,
              "profile-gamification-pills__pill--hot":
                streakDays >= STREAK_HOT_DAYS,
            }
          )}
          style={
            {
              "--streak-fire-background": getFirePalette(streakDays).background,
            } as React.CSSProperties
          }
          title={t("streak_tooltip", {
            count: streakDays,
            record: loginStreak.record,
          })}
        >
          {streakDays >= STREAK_EMBERS_DAYS && <StreakFire days={streakDays} />}
          <FlameIcon days={streakDays} />
          <strong>{t("streak_days", { count: streakDays })}</strong>
        </div>
      )}

      {coins !== null &&
        (onCoinsClick ? (
          <button
            type="button"
            className={cn(
              "profile-gamification-pills__pill",
              "profile-gamification-pills__pill--clickable"
            )}
            data-gamification-coins
            onClick={onCoinsClick}
          >
            {coinsContent}
          </button>
        ) : (
          <div
            className="profile-gamification-pills__pill"
            data-gamification-coins
          >
            {coinsContent}
          </div>
        ))}
    </div>
  );
}
