export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastStreakDate: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const toLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseLocalDateKey = (key: string): Date => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const diffInDays = (from: string, to: string): number => {
  const a = parseLocalDateKey(from).getTime();
  const b = parseLocalDateKey(to).getTime();
  return Math.round((b - a) / MS_PER_DAY);
};

export const bumpStreak = (state: StreakState, today: Date): StreakState => {
  const todayKey = toLocalDateKey(today);
  if (state.lastStreakDate === todayKey) return state;

  const days = state.lastStreakDate
    ? diffInDays(state.lastStreakDate, todayKey)
    : Infinity;

  const next = days === 1 ? state.currentStreak + 1 : 1;
  return {
    currentStreak: next,
    longestStreak: Math.max(state.longestStreak, next),
    lastStreakDate: todayKey,
  };
};

export const getDisplayStreak = (
  state: Partial<StreakState>,
  today: Date
): number => {
  if (!state.lastStreakDate || !state.currentStreak) return 0;
  const days = diffInDays(state.lastStreakDate, toLocalDateKey(today));
  return days <= 1 ? state.currentStreak : 0;
};

const PLAY_HISTORY_DAYS = 365;

export const appendPlayedDate = (
  history: string[] | undefined,
  today: Date
): string[] => {
  const todayKey = toLocalDateKey(today);
  const cutoffKey = toLocalDateKey(
    new Date(today.getTime() - (PLAY_HISTORY_DAYS - 1) * MS_PER_DAY)
  );

  const seen = new Set(history ?? []);
  seen.add(todayKey);

  return Array.from(seen)
    .filter((key) => key >= cutoffKey)
    .sort();
};
