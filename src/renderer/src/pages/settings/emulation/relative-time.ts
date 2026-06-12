const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

export function formatRelativeShort(ts: number, language: string): string {
  const minutes = Math.floor((Date.now() - ts) / MILLISECONDS_PER_MINUTE);

  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;

  if (minutes < 1) {
    value = 0;
    unit = "second";
  } else if (minutes < MINUTES_PER_HOUR) {
    value = -minutes;
    unit = "minute";
  } else if (minutes < MINUTES_PER_DAY) {
    value = -Math.floor(minutes / MINUTES_PER_HOUR);
    unit = "hour";
  } else {
    value = -Math.floor(minutes / MINUTES_PER_DAY);
    unit = "day";
  }

  return new Intl.RelativeTimeFormat(language, {
    numeric: "auto",
    style: "short",
  }).format(value, unit);
}
