const ALLOWED_REMOTE_HOSTS = [
  "steamgriddb.com",
  "losbroxas.org",
  "steamstatic.com",
  "akamaihd.net",
  "launchbox-app.com",
];

const isAllowedRemoteHost = (hostname: string) =>
  ALLOWED_REMOTE_HOSTS.some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  );

export const parseCoverPosterRemoteUrl = (
  url: string,
  baseUrl?: URL
): URL | null => {
  try {
    const parsed = baseUrl ? new URL(url, baseUrl) : new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.port && parsed.port !== "443") return null;
    if (!isAllowedRemoteHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
};
