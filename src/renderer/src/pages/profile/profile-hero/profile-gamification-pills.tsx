import { useTranslation } from "react-i18next";
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
import { openProfileTab } from "../profile-tab-events";
import { useProfileGamification } from "../use-profile-gamification";
import "./profile-gamification-pills.scss";

const LEVEL_PILL_HALO_ALPHA = 0.07;

export function ProfileGamificationPills() {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const { level, loginStreak, coins, isMe } = useProfileGamification();
  const halo = useHoverHalo<HTMLDivElement>(LEVEL_PILL_HALO_ALPHA);
  const shownCoins = useAnimatedNumber(coins ?? 0);

  if (!level) return null;

  const streakDays = loginStreak?.current ?? 0;

  return (
    <div className="profile-gamification-pills">
      <div
        ref={halo.hostRef}
        className={cn(
          "profile-gamification-pills__pill",
          "profile-gamification-pills__pill--level",
          { "profile-gamification-pills__pill--clickable": isMe }
        )}
        role={isMe ? "button" : undefined}
        tabIndex={isMe ? 0 : undefined}
        onClick={isMe ? () => openProfileTab("missions") : undefined}
        onKeyDown={
          isMe
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openProfileTab("missions");
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

      {coins !== null && (
        <div
          className="profile-gamification-pills__pill"
          data-gamification-coins
        >
          <CoinIcon />
          <span>
            <strong>{formatNumber(shownCoins)}</strong>{" "}
            {t("coins_label", { count: coins })}
          </span>
        </div>
      )}
    </div>
  );
}
