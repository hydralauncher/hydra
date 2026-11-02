export const isRetroArchEmulationDeepLink = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return (
    params.get("tab") === "emulation" && params.get("system") === "retroarch"
  );
};

export const isRpcs3EmulationDeepLink = (search: string): boolean => {
  const params = new URLSearchParams(search);
  return params.get("tab") === "emulation" && params.get("system") === "ps3";
};
