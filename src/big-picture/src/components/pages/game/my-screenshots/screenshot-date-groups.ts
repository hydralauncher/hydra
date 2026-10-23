import { useCallback } from "react";
import { useTranslation } from "react-i18next";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CaptureDayGroup<Item> {
  key: string;
  dayStart: number;
  items: Item[];
}

const getDayStart = (timestamp: number) => {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
};

export const groupByCaptureDay = <Item>(
  items: Item[],
  getCapturedAt: (item: Item) => number
): CaptureDayGroup<Item>[] => {
  const groups = new Map<number, Item[]>();
  const sorted = items.toSorted(
    (left, right) => getCapturedAt(right) - getCapturedAt(left)
  );

  for (const item of sorted) {
    const dayStart = getDayStart(getCapturedAt(item));
    const group = groups.get(dayStart);
    if (group) group.push(item);
    else groups.set(dayStart, [item]);
  }

  return [...groups.entries()].map(([dayStart, groupItems]) => ({
    key: String(dayStart),
    dayStart,
    items: groupItems,
  }));
};

const capitalize = (value: string) =>
  value.charAt(0).toLocaleUpperCase() + value.slice(1);

export function useCaptureDayLabel() {
  const { t, i18n } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";

  return useCallback(
    (dayStart: number) => {
      const today = getDayStart(Date.now());
      if (dayStart === today) return t("screenshots_date_today");
      if (dayStart === getDayStart(today - DAY_MS / 2)) {
        return t("screenshots_date_yesterday");
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
