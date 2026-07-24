const VALID_TRACKER_PROTOCOLS = ["http:", "https:", "udp:", "ws:", "wss:"];
const VALID_TRACKER_LIST_PROTOCOLS = ["http:", "https:"];

const isValidUrlWithHost = (url: string, protocols: string[]): boolean => {
  if (url.includes(":///")) return false;
  try {
    const parsed = new URL(url);
    return protocols.includes(parsed.protocol) && !!parsed.hostname;
  } catch {
    return false;
  }
};

export const isValidTrackerUrl = (url: string): boolean =>
  isValidUrlWithHost(url, VALID_TRACKER_PROTOCOLS);

export const isValidTrackerListUrl = (url: string): boolean =>
  isValidUrlWithHost(url, VALID_TRACKER_LIST_PROTOCOLS);

export const parseTrackerList = (data: string): string[] => {
  const lines = data
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  return [...new Set(lines)];
};
