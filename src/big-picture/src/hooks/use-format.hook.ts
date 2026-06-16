import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

export const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export function useFormat() {
  const { i18n, t } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(language, {
      maximumFractionDigits: 0,
    });
  }, [language]);

  const compactNumberFormatter = useMemo(() => {
    return new Intl.NumberFormat(language, {
      maximumFractionDigits: 0,
      notation: "compact",
    });
  }, [language]);

  const formatPlayTime = useCallback(
    (playTimeInSeconds: number) => {
      const minutes = playTimeInSeconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        const roundedMinutes = Number(minutes.toFixed(0));
        return t("playtime_minutes", { count: roundedMinutes });
      }

      const hours = minutes / 60;
      const roundedHours = Number(hours.toFixed(0));
      return t("playtime_hours", {
        count: roundedHours,
        formattedCount: numberFormatter.format(roundedHours),
      });
    },
    [numberFormatter, t]
  );

  return {
    formatNumber: numberFormatter.format,
    formatCompactNumber: compactNumberFormatter.format,
    formatPlayTime,
  };
}
