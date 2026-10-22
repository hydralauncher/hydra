import { useTranslation } from "react-i18next";
import {
  CoinIcon,
  FlameIcon,
  LevelSeal,
  XpBar,
} from "@renderer/components/gamification";
import { useFormat } from "@renderer/hooks";
import { useProfileGamification } from "../use-profile-gamification";
import "./profile-gamification-pills.scss";

export function ProfileGamificationPills() {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const { level, loginStreak, coins } = useProfileGamification();

  if (!level) return null;

  return (
    <div className="profile-gamification-pills">
      <div className="profile-gamification-pills__pill profile-gamification-pills__pill--level">
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
      </div>

      {loginStreak && (
        <div
          className="profile-gamification-pills__pill"
          title={t("streak_tooltip", {
            count: loginStreak.current,
            record: loginStreak.record,
          })}
        >
          <FlameIcon isDim={loginStreak.current === 0} />
          <strong>{t("streak_days", { count: loginStreak.current })}</strong>
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
