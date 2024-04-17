import { formatDistance } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";
import { ptBR, enUS, es, fr } from "date-fns/locale";
import { useTranslation } from "react-i18next";

export function useDate() {
  const { i18n } = useTranslation();

  const getDateLocale = (language: string) => {
    if (language.startsWith("pt")) return ptBR;
    if (language.startsWith("es")) return es;
    if (language.startsWith("fr")) return fr;
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
          locale: getDateLocale(i18n.language),
        });
      } catch (err) {
        return "";
      }
    },
  };
}
