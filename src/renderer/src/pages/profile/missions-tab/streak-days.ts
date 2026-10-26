import type { LoginStreak } from "@types";

export const STREAK_DAYS_SHOWN = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StreakDay {
  date: Date;
  isLit: boolean;
  isToday: boolean;
}

const startOfUtcDay = (time: number) =>
  Math.floor(time / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY;

// Shorter streaks start at their first day so the bar fills toward day 7; longer ones end today.
export const buildStreakDays = (
  streak: LoginStreak,
  now = Date.now()
): StreakDay[] => {
  const today = startOfUtcDay(now);
  const streakEnd = streak.hasPlayedToday
    ? today
    : today - MILLISECONDS_PER_DAY;
  const streakStart = streakEnd - (streak.current - 1) * MILLISECONDS_PER_DAY;
  const firstDay =
    streak.current >= STREAK_DAYS_SHOWN
      ? today - (STREAK_DAYS_SHOWN - 1) * MILLISECONDS_PER_DAY
      : streak.current > 0
        ? streakStart
        : today;

  return Array.from({ length: STREAK_DAYS_SHOWN }, (_, index) => {
    const day = firstDay + index * MILLISECONDS_PER_DAY;
    return {
      date: new Date(day),
      isLit: streak.current > 0 && day >= streakStart && day <= streakEnd,
      isToday: day === today,
    };
  });
};
