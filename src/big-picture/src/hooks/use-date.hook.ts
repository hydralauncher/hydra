import {
  ptBR,
  enUS,
  es,
  fr,
  pl,
  hu,
  tr,
  ru,
  it,
  be,
  zhCN,
  da,
} from "date-fns/locale";
import { format, formatDistance, subMilliseconds } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";

export type DateLike = number | Date | string;

export const getDateLocale = (language: string) => {
  if (language.startsWith("pt")) return ptBR;
  if (language.startsWith("es")) return es;
  if (language.startsWith("fr")) return fr;
  if (language.startsWith("hu")) return hu;
  if (language.startsWith("pl")) return pl;
  if (language.startsWith("tr")) return tr;
  if (language.startsWith("ru")) return ru;
  if (language.startsWith("it")) return it;
  if (language.startsWith("be")) return be;
  if (language.startsWith("zh")) return zhCN;
  if (language.startsWith("da")) return da;

  return enUS;
};

export const formatDate = (date: DateLike, language: string): string => {
  if (Number.isNaN(new Date(date).getDate())) return "N/A";
  return format(date, language == "en" ? "MM-dd-yyyy" : "dd/MM/yyyy");
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
          locale: getDateLocale("en"),
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
          locale: getDateLocale("en"),
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },

    formatDateTime: (date: DateLike): string => {
      try {
        return format(date, "MM-dd-yyyy - hh:mm a", {
          locale: getDateLocale("en"),
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },

    formatDate: (date: DateLike) => formatDate(date, "en"),
  };
}
