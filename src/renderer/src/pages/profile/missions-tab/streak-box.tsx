import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  FlameIcon,
  STREAK_STAGES,
  getStreakStageIndex,
  rampColor,
} from "@renderer/components/gamification";
import type { LoginStreak } from "@types";

const DAYS_SHOWN = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function StreakBox({ streak }: Readonly<{ streak: LoginStreak }>) {
  const { t, i18n } = useTranslation("user_profile");

  const days = useMemo(() => {
    const weekdayFormatter = new Intl.DateTimeFormat(i18n.language, {
      weekday: "narrow",
    });
    const litCount = Math.min(streak.current, DAYS_SHOWN);
    // The streak ends today once today counts, otherwise yesterday.
    const lastLitIndex = streak.hasPlayedToday
      ? DAYS_SHOWN - 1
      : DAYS_SHOWN - 2;

    return Array.from({ length: DAYS_SHOWN }, (_, index) => {
      const date = new Date(
        Date.now() - (DAYS_SHOWN - 1 - index) * MILLISECONDS_PER_DAY
      );
      return {
        key: index,
        label: weekdayFormatter.format(date),
        isLit: index <= lastLitIndex && index > lastLitIndex - litCount,
        isToday: index === DAYS_SHOWN - 1,
      };
    });
  }, [streak, i18n.language]);

  const stageLabel = (() => {
    const index = getStreakStageIndex(streak.current);
    const stage = t(`streak_stage_${STREAK_STAGES[index].key}`);
    const next = STREAK_STAGES[index + 1];

    if (index === 0) {
      return t("streak_stage_start", { stage: t("streak_stage_spark") });
    }
    if (!next) return t("streak_stage_top", { stage });
    return t("streak_stage_next", {
      stage,
      next: t(`streak_stage_${next.key}`),
      days: next.minDays,
    });
  })();

  return (
    <div className="streak-box">
      <div className="streak-box__summary">
        <FlameIcon size={36} days={streak.current} />
        <div>
          <strong>{t("streak_in_a_row", { count: streak.current })}</strong>
          <small>{stageLabel}</small>
          <small>{t("streak_record_hint", { count: streak.record })}</small>
        </div>
      </div>

      <div className="streak-box__week" aria-label={t("last_7_days")}>
        {days.map((day) => (
          <div
            key={day.key}
            className={cn("streak-box__day", {
              "streak-box__day--today": day.isToday,
            })}
          >
            <i
              style={
                day.isLit
                  ? {
                      background: `linear-gradient(90deg, ${rampColor(day.key / DAYS_SHOWN)}, ${rampColor((day.key + 1) / DAYS_SHOWN)})`,
                    }
                  : undefined
              }
            />
            <span>{day.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
