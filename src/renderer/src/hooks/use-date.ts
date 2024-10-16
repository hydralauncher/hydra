import { format, formatDistance, subMilliseconds } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";
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
import { useTranslation } from "react-i18next";

export function useDate() {
  const { i18n } = useTranslation();

  const { language } = i18n;

  const getDateLocale = () => {
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

  return {
    formatDistance: (
      date: string | number | Date,
      baseDate: string | number | Date,
      options?: FormatDistanceOptions
    ) => {
      try {
        return formatDistance(date, baseDate, {
          ...options,
          locale: getDateLocale(),
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
          locale: getDateLocale(),
        });
      } catch (err) {
        return "";
      }
    },

    formatDateTime: (date: number | Date | string): string => {
      const locale = getDateLocale();
      return format(
        date,
        locale == enUS ? "MM/dd/yyyy - HH:mm" : "dd/MM/yyyy - HH:mm"
      );
    },

    formatDate: (date: number | Date | string): string => {
      const locale = getDateLocale();
      return format(date, locale == enUS ? "MM/dd/yyyy" : "dd/MM/yyyy");
    },
  };
}
