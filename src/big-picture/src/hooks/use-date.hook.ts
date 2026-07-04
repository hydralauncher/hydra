import { enUS, es, ptBR, ru } from "date-fns/locale";  // ✅ Cambiar esES, esLAT por es
import { format, formatDistance, subMilliseconds } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";
import { useTranslation } from "react-i18next";

export type DateLike = number | Date | string;


export const getDateFormat = (language: string) => {
  if (language === "es-ES") return "dd/MM/yyyy";
  if (language === "es-LAT") return "MM/dd/yyyy";
  return language.startsWith("en") ? "MM-dd-yyyy" : "dd/MM/yyyy";
};

function getDateLocale(language: string) {
  if (language.startsWith("ru")) return ru;
  if (language.startsWith("pt")) return ptBR;
  if (language.startsWith("es")) return es;  // ✅ Usar es para todas las variantes
  return enUS;
}



function getDateTimeFormat(language: string) {
  if (language === "es-ES" || language === "es-LAT") return "dd/MM/yyyy HH:mm";
  return language.startsWith("en")
    ? "MM-dd-yyyy - hh:mm a"
    : "dd/MM/yyyy HH:mm";
}

export const formatDate = (date: DateLike, language = "en"): string => {
  if (Number.isNaN(new Date(date).getDate())) return "N/A";
  return format(date, getDateFormat(language), {
    locale: getDateLocale(language),
  });
};

export function useDate() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const locale = getDateLocale(language);

  return {
    formatDistance: (
      date: DateLike,
      baseDate: DateLike,
      options?: FormatDistanceOptions
    ) => {
      try {
        return formatDistance(date, baseDate, {
          ...options,
          locale,
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
          locale,
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },

    formatDateTime: (date: DateLike): string => {
      try {
        return format(date, getDateTimeFormat(language), {
          locale,
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },

    formatDate: (date: DateLike) => formatDate(date, language),
  };
}