interface SteamProtocolLaunchTarget {
  url: string;
  compatibilityPrefixPath: string;
}

export type SteamProtocolLaunchDispatchResult<T> =
  | { method: "steam"; value: null }
  | { method: "fallback"; value: T; error: unknown };

export const dispatchSteamProtocolLaunch = async <T>(
  target: SteamProtocolLaunchTarget,
  openExternal: (url: string) => Promise<void>,
  fallback: (compatibilityPrefixPath: string) => Promise<T>
): Promise<SteamProtocolLaunchDispatchResult<T>> => {
  try {
    await openExternal(target.url);
    return { method: "steam", value: null };
  } catch (error) {
    return {
      method: "fallback",
      value: await fallback(target.compatibilityPrefixPath),
      error,
    };
  }
};
