export type ScreenshotsTotalUpdate =
  | { kind: "server"; total: number; isFiltered: boolean }
  | { kind: "removed" };

export type ProfileScreenshotsTotalUpdate = ScreenshotsTotalUpdate & {
  userId: string;
};

export interface ScreenshotsTotalProfile {
  id: string;
  screenshotCount?: number;
}

export const applyScreenshotsTotalUpdate = (
  current: number,
  update: ScreenshotsTotalUpdate
) => {
  if (update.kind === "removed") return Math.max(0, current - 1);
  return update.isFiltered ? current : update.total;
};

export const applyProfileScreenshotsTotalUpdate = (
  current: number | null,
  update: ProfileScreenshotsTotalUpdate,
  profile: ScreenshotsTotalProfile | null
) => {
  if (profile?.id !== update.userId) return current;
  return applyScreenshotsTotalUpdate(
    current ?? profile.screenshotCount ?? 0,
    update
  );
};
