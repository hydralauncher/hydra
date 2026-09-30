import type { Rpcs3ConfigRootStatus, Rpcs3DiscIdentityStatus } from "@types";
import type { CloudSaveSnapshotPanelMode } from "./cloud-save-presentation";

export const RPCS3_CONFIG_SETTINGS_URL =
  "/settings?tab=emulation&system=ps3&section=emulator";

export const shouldShowRpcs3IdentityCard = (
  requiresDisc: boolean,
  status: Rpcs3DiscIdentityStatus | null | undefined,
  remoteIdentityError: boolean,
  isSyncing: boolean
) =>
  requiresDisc &&
  !isSyncing &&
  (remoteIdentityError ||
    (!!status && status.status !== "ready" && status.status !== "missing"));

export const getRpcs3ConfigWarningKey = (
  status: Rpcs3ConfigRootStatus["status"] | null | undefined
) =>
  status && status !== "ready" ? `cloud_save_v2_rpcs3_config_${status}` : null;

export const getCloudSavePanelMode = (
  hasExecutablePath: boolean,
  rpcs3ConfigStatus: Rpcs3ConfigRootStatus["status"] | null | undefined,
  snapshotMode: CloudSaveSnapshotPanelMode,
  isSyncing: boolean
): CloudSaveSnapshotPanelMode | "missing-executable" | "rpcs3-config" => {
  if (!hasExecutablePath) return "missing-executable";
  if (!isSyncing && getRpcs3ConfigWarningKey(rpcs3ConfigStatus))
    return "rpcs3-config";
  return snapshotMode;
};

export const shouldShowRpcs3SnapshotWhileBlocked = (
  panelMode: ReturnType<typeof getCloudSavePanelMode> | "rpcs3-identity",
  hasActiveSnapshot: boolean
) => panelMode === "rpcs3-config" && hasActiveSnapshot;
