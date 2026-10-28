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
import { STREAK_DAYS_SHOWN, buildStreakDays } from "./streak-days";

export function StreakBox({ streak }: Readonly<{ streak: LoginStreak }>) {
  const { t, i18n } = useTranslation("user_profile");

  const days = useMemo(() => {
    const weekdayFormatter = new Intl.DateTimeFormat(i18n.language, {
      weekday: "narrow",
      timeZone: "UTC",
    });

    return buildStreakDays(streak).map((day, index) => ({
      key: index,
      label: weekdayFormatter.format(day.date),
      isLit: day.isLit,
      isToday: day.isToday,
    }));
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

      <div className="streak-box__week" aria-label={t("streak_days")}>
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
                      background: `linear-gradient(90deg, ${rampColor(day.key / STREAK_DAYS_SHOWN)}, ${rampColor((day.key + 1) / STREAK_DAYS_SHOWN)})`,
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
