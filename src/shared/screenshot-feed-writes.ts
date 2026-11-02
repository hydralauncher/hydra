import type { ProfileScreenshot } from "@types";

export type ScreenshotPatch =
  | Partial<ProfileScreenshot>
  | ((screenshot: ProfileScreenshot) => Partial<ProfileScreenshot>);

export const applyScreenshotPatch = (
  screenshot: ProfileScreenshot,
  patch: ScreenshotPatch
): ProfileScreenshot => ({
  ...screenshot,
  ...(typeof patch === "function" ? patch(screenshot) : patch),
});

export const isRelativeScreenshotPatch = (patch: ScreenshotPatch) =>
  typeof patch === "function";

export interface ScreenshotFeedWrite {
  version: number;
  screenshotId: string;
  patch: ScreenshotPatch | null;
}

export const applyScreenshotFeedWrites = (
  items: ProfileScreenshot[],
  writes: ScreenshotFeedWrite[],
  sinceVersion: number
) => {
  let result = items;
  let netCountDelta = 0;
  let hasLaterWrites = false;
  const recountIds = new Set<string>();

  for (const write of writes) {
    if (write.version <= sinceVersion) continue;
    hasLaterWrites = true;

    if (write.patch === null) {
      const remaining = result.filter((item) => item.id !== write.screenshotId);
      netCountDelta -= result.length - remaining.length;
      result = remaining;
      continue;
    }

    const { patch } = write;
    if (isRelativeScreenshotPatch(patch)) {
      if (result.some((item) => item.id === write.screenshotId)) {
        recountIds.add(write.screenshotId);
      }
      continue;
    }

    result = result.map((item) =>
      item.id === write.screenshotId ? applyScreenshotPatch(item, patch) : item
    );
  }

  return { items: result, netCountDelta, hasLaterWrites, recountIds };
};
