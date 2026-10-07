export const getMockUnlockPercentage = (points?: number) => {
  if (typeof points !== "number") return null;

  return Math.min(100, Math.max(0.1, 100 - 2 * Math.sqrt(points)));
};
