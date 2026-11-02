import type { Rpcs3ConfigRootStatus, Rpcs3DiscIdentityStatus } from "@types";
import type { CloudSaveSnapshotPanelMode } from "./cloud-save-presentation";
import type { RetroArchExecutableStatus } from "./retroarch-executable-status";

export const RPCS3_CONFIG_SETTINGS_URL =
  "/settings?tab=emulation&system=ps3&section=emulator";

export type Rpcs3ConfigCheckStatus =
  | Rpcs3ConfigRootStatus["status"]
  | "checking"
  | "error";

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
  status: Rpcs3ConfigCheckStatus | null | undefined
) =>
  status && status !== "ready" && status !== "checking"
    ? `cloud_save_v2_rpcs3_config_${status}`
    : null;

export const getCloudSavePanelMode = (
  hasMediaPath: boolean,
  rpcs3ConfigStatus: Rpcs3ConfigCheckStatus | null | undefined,
  snapshotMode: CloudSaveSnapshotPanelMode,
  isSyncing: boolean,
  retroArchExecutableStatus: RetroArchExecutableStatus | null = null
):
  | CloudSaveSnapshotPanelMode
  | "missing-executable"
  | "rpcs3-config"
  | "retroarch-config" => {
  if (isSyncing) return snapshotMode;
  if (
    retroArchExecutableStatus === "checking" ||
    rpcs3ConfigStatus === "checking"
  )
    return "skeleton";
  if (retroArchExecutableStatus && retroArchExecutableStatus !== "ready")
    return "retroarch-config";
  if (getRpcs3ConfigWarningKey(rpcs3ConfigStatus)) return "rpcs3-config";
  if (!hasMediaPath) return "missing-executable";
  return snapshotMode;
};
