export const formatCountdown = (countdown: string | null | undefined): string => {
  if (!countdown) return "";

  // Matches "D-26UNRELEASED", "D+0UNCRACKED" and similar, inserting a space
  return countdown.replace(/^([a-z][+-]\d+)([a-z]+)$/i, "$1 $2");
};
