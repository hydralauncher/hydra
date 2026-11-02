export type RetroArchExecutableStatus =
  | "checking"
  | "ready"
  | "missing"
  | "invalid"
  | "error";

export const RETROARCH_CONFIG_SETTINGS_URL =
  "/settings?tab=emulation&system=retroarch&section=emulator";

export const getRetroArchExecutableStatus = async (
  getConfig: () => Promise<{ executablePath: string | null }>,
  checkExecutable: () => Promise<{ exists: boolean }>
): Promise<RetroArchExecutableStatus> => {
  try {
    const config = await getConfig();
    if (!config.executablePath) return "missing";
    return (await checkExecutable()).exists ? "ready" : "invalid";
  } catch {
    return "error";
  }
};

export const isRetroArchSetupBlocked = (
  status: RetroArchExecutableStatus | null
) => status !== null && status !== "ready";

export const isRetroArchExecutableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : error;
  return (
    typeof message === "string" &&
    (message.includes("cloud_save_retroarch_not_configured") ||
      message.includes("cloud_save_retroarch_executable_missing"))
  );
};
