import { useCallback, useMemo } from "react";

export const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export function useFormat() {
  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat("en", {
      maximumFractionDigits: 0,
    });
  }, []);

  const compactNumberFormatter = useMemo(() => {
    return new Intl.NumberFormat("en", {
      maximumFractionDigits: 0,
      notation: "compact",
    });
  }, []);

  const formatPlayTime = useCallback(
    (playTimeInSeconds: number) => {
      const minutes = playTimeInSeconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return `${minutes.toFixed(0)} minutes`;
      }

      const hours = minutes / 60;
      return `${numberFormatter.format(hours)} hours`;
    },
    [numberFormatter]
  );

  return {
    formatNumber: numberFormatter.format,
    formatCompactNumber: compactNumberFormatter.format,
    formatPlayTime,
  };
}
