export const getLastUpdatedLabel = (updatedAt: string): string => {
  const date = new Date(updatedAt);
  if (isNaN(date.getTime())) return "Last updated: unknown";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 60) return `Last updated ${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `Last updated ${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  return `Last updated ${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
};
