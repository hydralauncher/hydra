import { formatDate, getDateLocale } from "@shared";
import { format, formatDistance, subMilliseconds } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";
import { useTranslation } from "react-i18next";

export function useDate() {
  const { i18n } = useTranslation();

  const { language } = i18n;

  return {
    formatDistance: (
      date: string | number | Date,
      baseDate: string | number | Date,
      options?: FormatDistanceOptions
    ) => {
      try {
        return formatDistance(date, baseDate, {
          ...options,
          locale: getDateLocale(language),
        });
      } catch (err) {
        return "";
      }
    },

    formatDiffInMillis: (
      millis: number,
      baseDate: string | number | Date,
      options?: FormatDistanceOptions
    ) => {
      try {
        return formatDistance(subMilliseconds(new Date(), millis), baseDate, {
          ...options,
          locale: getDateLocale(language),
        });
      } catch (err) {
        return "";
      }
    },

    formatDateTime: (date: number | Date | string): string => {
      return format(
        date,
        language == "en" ? "MM-dd-yyyy - hh:mm a" : "dd/MM/yyyy HH:mm",
        { locale: getDateLocale(language) }
      );
    },

    formatDate: (date: number | Date | string) => formatDate(date, language),
  };
}
