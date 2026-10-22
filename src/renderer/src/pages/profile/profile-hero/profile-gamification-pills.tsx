import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  CoinIcon,
  FlameIcon,
  LevelSeal,
  STREAK_EMBERS_DAYS,
  STREAK_FIRE_DAYS,
  STREAK_GLOW_DAYS,
  StreakFire,
  XpBar,
  useHoverHalo,
} from "@renderer/components/gamification";
import { useFormat } from "@renderer/hooks";
import { useProfileGamification } from "../use-profile-gamification";
import "./profile-gamification-pills.scss";

const LEVEL_PILL_HALO_ALPHA = 0.07;

export function ProfileGamificationPills() {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const { level, loginStreak, coins } = useProfileGamification();
  const halo = useHoverHalo<HTMLDivElement>(LEVEL_PILL_HALO_ALPHA);

  if (!level) return null;

  const streakDays = loginStreak?.current ?? 0;

  return (
    <div className="profile-gamification-pills">
      <div
        ref={halo.hostRef}
        className="profile-gamification-pills__pill profile-gamification-pills__pill--level"
        {...halo.handlers}
      >
        <LevelSeal level={level.level} size={34} />
        <strong>{t("level_number", { level: level.level })}</strong>
        <XpBar
          xp={level.xp}
          xpToNextLevel={level.xpToNextLevel}
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
                streakDays >= STREAK_GLOW_DAYS,
            }
          )}
          title={t("streak_tooltip", {
            count: streakDays,
            record: loginStreak.record,
          })}
        >
          {streakDays >= STREAK_EMBERS_DAYS && <StreakFire days={streakDays} />}
          <FlameIcon isDim={streakDays === 0} />
          <strong>{t("streak_days", { count: streakDays })}</strong>
        </div>
      )}

      {coins !== null && (
        <div className="profile-gamification-pills__pill">
          <CoinIcon />
          <span>
            <strong>{formatNumber(coins)}</strong>{" "}
            {t("coins_label", { count: coins })}
          </span>
        </div>
      )}
    </div>
  );
}
