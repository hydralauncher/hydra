import { parseWebUrl } from "./chat-links";

// Sites the user chose to open from messages without the leaving prompt.
const STORAGE_KEY = "chatTrustedLinkHosts";

const readTrustedHosts = (): string[] => {
  try {
    const hosts: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]"
    );
    return Array.isArray(hosts)
      ? hosts.filter((host): host is string => typeof host === "string")
      : [];
  } catch {
    return [];
  }
};

/** Whether a link opens without the prompt. Only https sites are trusted. */
export const isTrustedLink = (link: string) => {
  const url = parseWebUrl(link);
  return (
    url?.protocol === "https:" && readTrustedHosts().includes(url.hostname)
  );
};

export const trustLinkHost = (host: string) => {
  const hosts = readTrustedHosts();
  if (hosts.includes(host)) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...hosts, host]));
  } catch {
    // Storage is unavailable; the prompt keeps showing for this site.
  }
};
