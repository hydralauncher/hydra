import type { Rpcs3ConfigRootStatus } from "@types";

export const RPCS3_CONFIG_SETTINGS_URL =
  "/settings?tab=emulation&system=ps3&section=emulator";

export const getRpcs3ConfigWarningKey = (
  status: Rpcs3ConfigRootStatus["status"] | null | undefined
) =>
  status && status !== "ready" ? `cloud_save_v2_rpcs3_config_${status}` : null;
