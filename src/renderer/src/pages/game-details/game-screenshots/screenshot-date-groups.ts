import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { CAPTURE_DAY_MS, getCaptureDayStart } from "@shared";

const capitalize = (value: string) =>
  value.charAt(0).toLocaleUpperCase() + value.slice(1);

export function useCaptureDayLabel() {
  const { t, i18n } = useTranslation("screenshots");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";

  return useCallback(
    (dayStart: number) => {
      const today = getCaptureDayStart(Date.now());
      if (dayStart === today) return t("date_group_today");
      if (dayStart === getCaptureDayStart(today - CAPTURE_DAY_MS / 2)) {
        return t("date_group_yesterday");
      }

      const date = new Date(dayStart);
      const isThisYear = date.getFullYear() === new Date(today).getFullYear();
      return capitalize(
        new Intl.DateTimeFormat(language, {
          weekday: "long",
          month: "long",
          day: "numeric",
          ...(isThisYear ? {} : { year: "numeric" }),
        }).format(date)
      );
    },
    [language, t]
  );
}
