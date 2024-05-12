import { formatDistance } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";
import { ptBR, enUS, es, fr, pl, hu, tr, ru, it } from "date-fns/locale";
import { useTranslation } from "react-i18next";

export function useDate() {
  const { i18n } = useTranslation();

  const getDateLocale = () => {
    if (i18n.language.startsWith("pt")) return ptBR;
    if (i18n.language.startsWith("es")) return es;
    if (i18n.language.startsWith("fr")) return fr;
    if (i18n.language.startsWith("hu")) return hu;
    if (i18n.language.startsWith("pl")) return pl;
    if (i18n.language.startsWith("tr")) return tr;
    if (i18n.language.startsWith("ru")) return ru;
    if (i18n.language.startsWith("it")) return it;

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
  };
}
