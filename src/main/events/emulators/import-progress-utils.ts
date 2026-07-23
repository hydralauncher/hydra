export const bandPercent = (
  start: number,
  span: number,
  processed: number,
  total: number
): number => {
  const frac = total > 0 ? Math.min(1, processed / total) : 0;
  return Math.min(100, Math.round((start + frac * span) * 10) / 10);
};

export const baseNameWithoutExt = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};
