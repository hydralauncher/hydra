import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getCountdownParts, type WeekRange } from "./global-leaderboard";

const COUNTDOWN_TICK_MS = 30_000;
const WEEK_END_RETRY_BASE_MS = 30_000;
const WEEK_END_RETRY_MAX_MS = 5 * 60_000;

export interface WeekSubtitleProps {
  weekRange: WeekRange;
  isAllTime: boolean;
  onWeekEnd: () => void;
}

export function WeekSubtitle({
  weekRange,
  isAllTime,
  onWeekEnd,
}: Readonly<WeekSubtitleProps>) {
  const { t, i18n } = useTranslation("leaderboards");
  const [now, setNow] = useState(Date.now);
  const onWeekEndRef = useRef(onWeekEnd);
  onWeekEndRef.current = onWeekEnd;
  const endTime = weekRange.end.getTime();

  useEffect(() => {
    let attempts = 0;
    let nextAttemptAt = endTime;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current < nextAttemptAt) return;

      onWeekEndRef.current();
      nextAttemptAt =
        current +
        Math.min(WEEK_END_RETRY_MAX_MS, WEEK_END_RETRY_BASE_MS * 2 ** attempts);
      attempts += 1;
    };

    const interval = setInterval(tick, COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [endTime]);

  if (isAllTime) {
    // Same two lines as a week, so the page does not jump on toggle.
    return (
      <>
        <span className="leaderboards__subtitle">{t("subtitle_all")}</span>
        <span
          className="leaderboards__subtitle leaderboards__subtitle--countdown"
          aria-hidden="true"
        >
          &nbsp;
        </span>
      </>
    );
  }

  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const lastDay = new Date(endTime - 1);
  const { days, hours, minutes } = getCountdownParts(weekRange.end, now);
  let countdown = t("countdown_minutes", { minutes });
  if (days > 0) countdown = t("countdown_days", { days, hours });
  else if (hours > 0) countdown = t("countdown_hours", { hours, minutes });

  return (
    <>
      <span className="leaderboards__subtitle">
        {dateFormatter.formatRange(weekRange.start, lastDay)}
      </span>
      <span className="leaderboards__subtitle leaderboards__subtitle--countdown">
        {t("resets_in", { countdown })}
      </span>
    </>
  );
}
