export type DateSortableLibraryGame = {
  releaseDateTimestamp?: number | null;
  latestUpdateDate?: string | null;
  newDownloadOptionsCount?: number;
};

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  fev: 1,
  mar: 2,
  apr: 3,
  abr: 3,
  may: 4,
  mai: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  ago: 7,
  sep: 8,
  set: 8,
  oct: 9,
  out: 9,
  nov: 10,
  dec: 11,
  dez: 11,
};

export const parseSortableDate = (
  dateStr: string | null | undefined
): number => {
  if (!dateStr) return 0;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (isoMatch) {
    return Date.UTC(
      Number.parseInt(isoMatch[1], 10),
      Number.parseInt(isoMatch[2], 10) - 1,
      Number.parseInt(isoMatch[3], 10)
    );
  }

  const partialIsoMatch = /^(\d{4})(?:-(\d{2}))?$/.exec(dateStr);
  if (partialIsoMatch) {
    return Date.UTC(
      Number.parseInt(partialIsoMatch[1], 10),
      partialIsoMatch[2] ? Number.parseInt(partialIsoMatch[2], 10) - 1 : 0,
      1
    );
  }

  const nativeParse = Date.parse(dateStr);
  if (!Number.isNaN(nativeParse)) {
    const parsedDate = new Date(nativeParse);
    return Date.UTC(
      parsedDate.getUTCFullYear(),
      parsedDate.getUTCMonth(),
      parsedDate.getUTCDate()
    );
  }

  const yearMatch = /\d{4}/.exec(dateStr);
  if (!yearMatch) return 0;
  const year = Number.parseInt(yearMatch[0], 10);

  const lowerStr = dateStr.toLowerCase();
  const month = Object.entries(MONTHS).find(([key]) =>
    lowerStr.includes(key)
  )?.[1];
  const dayMatch = /\b(?:0?[1-9]|[12]\d|3[01])\b/.exec(
    dateStr.replace(yearMatch[0], "")
  );
  const day = dayMatch ? Number.parseInt(dayMatch[0], 10) : 1;

  return Date.UTC(year, month ?? 0, day);
};

export const compareNewUpdates = (
  a: DateSortableLibraryGame,
  b: DateSortableLibraryGame
): number => {
  const aDate = a.latestUpdateDate ? new Date(a.latestUpdateDate).getTime() : 0;
  const bDate = b.latestUpdateDate ? new Date(b.latestUpdateDate).getTime() : 0;
  if (aDate !== bDate) return bDate - aDate;

  return (b.newDownloadOptionsCount ?? 0) - (a.newDownloadOptionsCount ?? 0);
};

export const compareReleaseDates = (
  a: DateSortableLibraryGame,
  b: DateSortableLibraryGame
): number => (b.releaseDateTimestamp ?? 0) - (a.releaseDateTimestamp ?? 0);
