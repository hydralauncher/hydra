export function formatRelativeShort(ts: number, language: string): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  const rtf = new Intl.RelativeTimeFormat(language, {
    numeric: "auto",
    style: "short",
  });

  if (minutes < 1) return rtf.format(0, "second");
  if (minutes < 60) return rtf.format(-minutes, "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");

  const days = Math.floor(hours / 24);
  return rtf.format(-days, "day");
}
