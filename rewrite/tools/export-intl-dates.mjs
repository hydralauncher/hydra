// Exports the Intl.DateTimeFormat output the leaderboards page uses, so the
// rewrite prints the same dates as Chromium without an ICU date formatter:
//   - week-subtitle.tsx: formatRange(start, lastDay) with { day: "numeric",
//     month: "short", timeZone: "UTC" } ("Nov 2 – 8", "Oct 27 – Nov 2")
//   - stats-tab.tsx: { month: "short" } and { weekday: "short" } labels, and
//     { weekday: "short", day: "numeric", month: "short" } cell dates
// Templates keep the literal parts; "{m1}"/"{d1}" (start), "{m2}"/"{d2}"
// (end), "{y1}"/"{y2}" (years, in `digits`), "{w}"/"{d}"/"{m}" are replaced
// with the names stored next to them.
// Month names are indexed by the language's calendar month (Persian for fa,
// Gregorian elsewhere) and weekdays start on Monday; `digits` are the
// language's numerals for the day numbers.
// Output: crates/hydra-i18n/data/intl-dates.json
// Usage: node rewrite/tools/export-intl-dates.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "crates", "hydra-i18n", "data", "intl-dates.json");

// src/locales/index.ts
const languages = [
  "pt-BR", "pt-PT", "en", "de", "el", "es", "nl", "fr", "hu", "it", "pl", "ru", "tr", "be", "uk",
  "zh", "id", "ko", "da", "ar", "fa", "fi", "ro", "ca", "bg", "kk", "cs", "nb", "et", "uz", "sv",
  "lv", "vi", "ja", "sl",
];

const DAY_MS = 86_400_000;
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));

const template = (parts, names, numbered) =>
  parts
    .map((part) => {
      if (part.type === "literal") return part.value;
      const key = names[part.type];
      if (!key) return part.value;
      return numbered ? `{${key}${part.source === "endRange" ? "2" : "1"}}` : `{${key}}`;
    })
    .join("");

// The calendar month and day of a date, with Latin digits.
const calendarParts = (calendar, date) => {
  const parts = new Intl.DateTimeFormat(`en-u-ca-${calendar}-nu-latn`, {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).formatToParts(date);
  const read = (type) => Number(parts.find((p) => p.type === type).value);
  return { month: read("month"), day: read("day") };
};

// A date on the 3rd of each calendar month (a week inside it ends on the 9th).
const monthStarts = (calendar) => {
  const found = new Map();
  for (let i = 0; i < 400 && found.size < 12; i++) {
    const date = new Date(Date.UTC(2026, 0, 1) + i * DAY_MS);
    const { month, day } = calendarParts(calendar, date);
    if (day === 3 && !found.has(month)) found.set(month, date);
  }
  return Array.from({ length: 12 }, (_, i) => found.get(i + 1));
};

const result = {};
for (const language of languages) {
  const range = new Intl.DateTimeFormat(language, { day: "numeric", month: "short", timeZone: "UTC" });
  const { calendar, numberingSystem } = range.resolvedOptions();
  const starts = monthStarts(calendar);
  const sameMonth = range.formatRangeToParts(starts[10], new Date(starts[10].getTime() + 6 * DAY_MS));
  const crossMonth = range.formatRangeToParts(
    new Date(starts[10].getTime() - 7 * DAY_MS),
    new Date(starts[10].getTime() - DAY_MS)
  );
  const names = { day: "d", month: "m", year: "y" };
  // The last week of a year: Gregorian Dec 29 - Jan 4 (and its Persian dates).
  const crossYear = range.formatRangeToParts(utc(2025, 11, 29), utc(2026, 0, 4));
  // Day n as it reads inside a range (ja pads it: "01/03～01/09").
  const firstMonth = new Date(starts[0].getTime() - 2 * DAY_MS);
  const at = (day) => new Date(firstMonth.getTime() + (day - 1) * DAY_MS);
  const rangeDays = Array.from({ length: 31 }, (_, i) => {
    const n = i + 1;
    const parts =
      n <= 25 ? range.formatRangeToParts(at(n), at(n + 6)) : range.formatRangeToParts(at(n - 6), at(n));
    const source = n <= 25 ? "startRange" : "endRange";
    return parts.find((p) => p.type === "day" && p.source === source)?.value ?? String(n);
  });

  const month = new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" });
  const weekday = new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" });
  const cell = new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  // 2024-02-05 is a Monday.
  const mondays = Array.from({ length: 7 }, (_, i) => utc(2024, 1, 5 + i));
  const digits = new Intl.NumberFormat(`${language}-u-nu-${numberingSystem}`, { useGrouping: false });

  result[language] = {
    calendar,
    digits: Array.from({ length: 10 }, (_, i) => digits.format(i)).join(""),
    range_same: template(sameMonth, names, true),
    range_cross: template(crossMonth, names, true),
    range_cross_year: template(crossYear, names, true),
    range_days: rangeDays,
    // The month as it reads inside a range (some languages decline it there).
    range_months: starts.map(
      (date) =>
        range
          .formatRangeToParts(date, new Date(date.getTime() + 6 * DAY_MS))
          .find((p) => p.type === "month")?.value ?? ""
    ),
    months: starts.map((date) => month.format(date)),
    weekdays: mondays.map((date) => weekday.format(date)),
    cell: template(cell.formatToParts(starts[10]), { day: "d", month: "m", weekday: "w" }, false),
    cell_months: starts.map(
      (date) => cell.formatToParts(date).find((p) => p.type === "month")?.value ?? ""
    ),
    cell_weekdays: mondays.map(
      (date) => cell.formatToParts(date).find((p) => p.type === "weekday")?.value ?? ""
    ),
  };
}

fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
console.log(`wrote ${out} (${languages.length} languages, ICU ${process.versions.icu})`);
