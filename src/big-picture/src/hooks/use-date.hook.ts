import { el, enUS, es, fr, ptBR, ru } from "date-fns/locale";
import { format, formatDistance, subMilliseconds } from "date-fns";
import type { FormatDistanceOptions } from "date-fns";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

export type DateLike = number | Date | string;

function getDateLocale(language: string) {
  if (language.startsWith("ru")) return ru;
  if (language.startsWith("pt")) return ptBR;
  if (language.startsWith("es")) return es;
  if (language.startsWith("fr")) return fr;
  if (language.startsWith("el")) return el;
  return enUS;
}

function getDateFormat(language: string) {
  return language.startsWith("en") ? "MM-dd-yyyy" : "dd/MM/yyyy";
}

function getDateTimeFormat(language: string) {
  return language.startsWith("en")
    ? "MM-dd-yyyy - hh:mm a"
    : "dd/MM/yyyy HH:mm";
}

function getTimeFormat(language: string) {
  return language.startsWith("en") ? "h:mm a" : "HH:mm";
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

  const formatDistanceCallback = useCallback(
    (date: DateLike, baseDate: DateLike, options?: FormatDistanceOptions) => {
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
    [locale]
  );

  const formatDiffInMillis = useCallback(
    (millis: number, baseDate: DateLike, options?: FormatDistanceOptions) => {
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
    [locale]
  );

  const formatDateTime = useCallback(
    (date: DateLike): string => {
      try {
        return format(date, getDateTimeFormat(language), {
          locale,
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },
    [language, locale]
  );

  const formatDateCallback = useCallback(
    (date: DateLike) => formatDate(date, language),
    [language]
  );

  const formatTime = useCallback(
    (date: DateLike): string => {
      try {
        return format(date, getTimeFormat(language), {
          locale,
        });
      } catch (err) {
        console.error(err);
        return "";
      }
    },
    [language, locale]
  );

  return useMemo(
    () => ({
      formatDistance: formatDistanceCallback,
      formatDiffInMillis,
      formatDateTime,
      formatDate: formatDateCallback,
      formatTime,
    }),
    [
      formatDistanceCallback,
      formatDiffInMillis,
      formatDateTime,
      formatDateCallback,
      formatTime,
    ]
  );
}
