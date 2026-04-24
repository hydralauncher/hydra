import { isYesterday, parseISO } from "date-fns";

const UTC_SUFFIX = "Z";
const TIMEZONE_OFFSET_REGEX = /(?:Z|[+-]\d{2}:\d{2})$/i;
const ISO_WITHOUT_TIMEZONE_REGEX = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+)?$/;

export function formatPlayedTime(
  valueInMilliseconds: number | null | undefined,
  options?: {
    zeroFallback?: string;
  }
) {
  const safeValue = Math.max(0, valueInMilliseconds ?? 0);

  if (safeValue === 0 && options?.zeroFallback) {
    return options.zeroFallback;
  }

  const totalSeconds = Math.floor(safeValue / 1000);

  if (totalSeconds < 60) {
    const seconds = Math.max(1, totalSeconds);
    return `${seconds} ${seconds === 1 ? "second" : "seconds"} played`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} ${totalMinutes === 1 ? "minute" : "minutes"} played`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  return `${totalHours} ${totalHours === 1 ? "hour" : "hours"} played`;
}

export function formatRelativeDate(
  value: Date | string | number | null | undefined,
  options?: {
    locale?: string;
    fallback?: string;
    now?: Date | number;
  }
) {
  if (value == null) return options?.fallback ?? "";

  let date: Date;
  if (typeof value === "string") {
    let isoString = value;
    if (
      ISO_WITHOUT_TIMEZONE_REGEX.test(value) &&
      !TIMEZONE_OFFSET_REGEX.test(value)
    ) {
      isoString = `${value}${UTC_SUFFIX}`;
    }
    date = parseISO(isoString);
  } else {
    date = new Date(value);
  }

  const now =
    options?.now instanceof Date
      ? options.now
      : new Date(options?.now ?? Date.now());

  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) {
    return options?.fallback ?? "";
  }

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";

  const rtf = new Intl.RelativeTimeFormat(options?.locale ?? "en", {
    numeric: "always",
  });

  const minutes = Math.floor(diffSec / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");

  if (isYesterday(date)) return "yesterday";

  const days = Math.floor(hours / 24);
  if (days < 30) return rtf.format(-days, "day");

  const months = Math.floor(days / 30);
  if (months < 12) return rtf.format(-Math.max(months, 1), "month");

  const years = Math.floor(days / 365);
  if (years === 1) return "last year";

  return rtf.format(-years, "year");
}
