import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getCountdownParts,
  getIsoWeekNumber,
  type WeekRange,
} from "./global-leaderboard";

const COUNTDOWN_TICK_MS = 30_000;

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
    let notified = false;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= endTime && !notified) {
        notified = true;
        onWeekEndRef.current();
      }
    };

    const interval = setInterval(tick, COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [endTime]);

  if (isAllTime) {
    return <span className="leaderboards__subtitle">{t("subtitle_all")}</span>;
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
    <span className="leaderboards__subtitle">
      {t("subtitle_week", {
        number: getIsoWeekNumber(weekRange.start),
        range: dateFormatter.formatRange(weekRange.start, lastDay),
        countdown,
      })}
    </span>
  );
}
