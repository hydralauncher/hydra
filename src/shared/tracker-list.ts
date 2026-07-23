const VALID_TRACKER_PROTOCOLS = ["http:", "https:", "udp:", "ws:", "wss:"];
const VALID_TRACKER_LIST_PROTOCOLS = ["http:", "https:"];

export const isValidTrackerUrl = (url: string): boolean => {
  try {
    return VALID_TRACKER_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

export const isValidTrackerListUrl = (url: string): boolean => {
  try {
    return VALID_TRACKER_LIST_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

export const parseTrackerList = (data: string): string[] => {
  const lines = data
    .split(/[\r\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  return [...new Set(lines)];
};
