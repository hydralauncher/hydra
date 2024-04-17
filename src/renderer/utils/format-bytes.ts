export function formatBytes(bytes: number) {
  if (bytes === 0) return 0;
  const megabytes = bytes / (1024 * 1024);
  return megabytes.toFixed(2);
}
