import { formatDate, getDateLocale } from "@shared";
import { format, formatDistance, subMilliseconds } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";
import { enUS } from "date-fns/locale";
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
      const locale = getDateLocale(language);
      return format(
        date,
        locale == enUS ? "MM/dd/yyyy - HH:mm" : "dd/MM/yyyy HH:mm"
      );
    },

    formatDate: (date: number | Date | string) => formatDate(date, language),
  };
}
