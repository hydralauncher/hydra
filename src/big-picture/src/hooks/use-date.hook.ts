import { enUS } from "date-fns/locale";
import { format, formatDistance, subMilliseconds } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";

export type DateLike = number | Date | string;

export const formatDate = (date: DateLike): string => {
  if (Number.isNaN(new Date(date).getDate())) return "N/A";
  return format(date, "MM-dd-yyyy");
};

export function useDate() {
  return {
    formatDistance: (
      date: DateLike,
      baseDate: DateLike,
      options?: FormatDistanceOptions
    ) => {
      try {
        return formatDistance(date, baseDate, {
          ...options,
          locale: enUS,
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },

    formatDiffInMillis: (
      millis: number,
      baseDate: DateLike,
      options?: FormatDistanceOptions
    ) => {
      try {
        return formatDistance(subMilliseconds(new Date(), millis), baseDate, {
          ...options,
          locale: enUS,
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },

    formatDateTime: (date: DateLike): string => {
      try {
        return format(date, "MM-dd-yyyy - hh:mm a", {
          locale: enUS,
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },

    formatDate,
  };
}
