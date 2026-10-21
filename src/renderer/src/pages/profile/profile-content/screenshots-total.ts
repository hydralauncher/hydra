export type ScreenshotsTotalUpdate =
  | { kind: "server"; total: number; isFiltered: boolean }
  | { kind: "removed" };

export const applyScreenshotsTotalUpdate = (
  current: number,
  update: ScreenshotsTotalUpdate
) => {
  if (update.kind === "removed") return Math.max(0, current - 1);
  return update.isFiltered ? current : update.total;
};
