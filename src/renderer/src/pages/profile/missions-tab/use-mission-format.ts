import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "@renderer/hooks";
import type { Mission } from "@types";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const HOURS_TARGET_FROM_SECONDS = 2 * SECONDS_PER_HOUR;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return now;
}

export function useMissionFormat() {
  const { t, i18n } = useTranslation("user_profile");
  const { formatNumber } = useFormat();

  const decimalFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }),
    [i18n.language]
  );

  const formatProgress = useCallback(
    (mission: Pick<Mission, "unit" | "current" | "target">) => {
      const { unit, current, target } = mission;

      if (unit === "seconds") {
        if (target >= HOURS_TARGET_FROM_SECONDS) {
          return t("mission_progress_hours", {
            current: decimalFormatter.format(current / SECONDS_PER_HOUR),
            target: decimalFormatter.format(target / SECONDS_PER_HOUR),
          });
        }
        return t("mission_progress_minutes", {
          current: Math.floor(current / SECONDS_PER_MINUTE),
          target: Math.round(target / SECONDS_PER_MINUTE),
        });
      }

      if (unit === "days") {
        return t("mission_progress_days", { current, target, count: target });
      }

      return t("mission_progress_count", {
        current: formatNumber(current),
        target: formatNumber(target),
      });
    },
    [t, decimalFormatter, formatNumber]
  );

  const formatMissionStatus = useCallback(
    (mission: Mission) => {
      const progress = formatProgress(mission);
      if (mission.pending <= 0) return progress;
      return `${progress} · ${t("mission_awaiting_review", { count: mission.pending })}`;
    },
    [t, formatProgress]
  );

  const formatCountdown = useCallback(
    (remainingMs: number) => {
      const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
      const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
      const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / 60);
      const seconds = totalSeconds % 60;
      return t("countdown", {
        hours,
        minutes: String(minutes).padStart(2, "0"),
        seconds: String(seconds).padStart(2, "0"),
      });
    },
    [t]
  );

  const formatResetLabel = useCallback(
    (resetsAt: string, now: number, withWeekday: boolean) => {
      const reset = new Date(resetsAt);
      const remaining = reset.getTime() - now;

      if (!withWeekday || remaining <= MILLISECONDS_PER_DAY) {
        return t("missions_resets_in", { time: formatCountdown(remaining) });
      }

      return t("missions_resets_on", {
        day: new Intl.DateTimeFormat(i18n.language, {
          weekday: "long",
        }).format(reset),
        time: new Intl.DateTimeFormat(i18n.language, {
          hour: "2-digit",
          minute: "2-digit",
        }).format(reset),
      });
    },
    [t, i18n.language, formatCountdown]
  );

  return {
    formatProgress,
    formatMissionStatus,
    formatCountdown,
    formatResetLabel,
  };
}
