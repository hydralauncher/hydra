import type { ProfileScreenshot } from "@types";

export interface ScreenshotFeedWrite {
  version: number;
  screenshotId: string;
  patch: Partial<ProfileScreenshot> | null;
}

export function applyScreenshotFeedWrites(
  items: ProfileScreenshot[],
  writes: ScreenshotFeedWrite[],
  sinceVersion: number
) {
  let result = items;
  let removedCount = 0;

  for (const write of writes) {
    if (write.version <= sinceVersion) continue;

    if (write.patch === null) {
      const next = result.filter((item) => item.id !== write.screenshotId);
      removedCount += result.length - next.length;
      result = next;
      continue;
    }

    const { patch } = write;
    result = result.map((item) =>
      item.id === write.screenshotId ? { ...item, ...patch } : item
    );
  }

  return { items: result, removedCount };
}

export function pickNewerScreenshot(
  listItem: ProfileScreenshot | null,
  listFetchedAt: number | null,
  detached: ProfileScreenshot | null,
  detachedFetchedAt: number | null
) {
  if (!listItem || !detached) return listItem ?? detached;

  return (detachedFetchedAt ?? 0) > (listFetchedAt ?? 0) ? detached : listItem;
}
