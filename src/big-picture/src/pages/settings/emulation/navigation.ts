export const isRetroArchEmulationDeepLink = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return (
    params.get("tab") === "emulation" && params.get("system") === "retroarch"
  );
};

export const getEmulatorDetailDeepLinkSystem = (
  search: string
): "ps3" | "ps4" | null => {
  const params = new URLSearchParams(search);
  if (params.get("tab") !== "emulation") return null;
  const system = params.get("system");
  return system === "ps3" || system === "ps4" ? system : null;
};
