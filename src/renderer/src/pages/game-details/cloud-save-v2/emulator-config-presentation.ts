import type {
  EmulatorDiscIdentityStatus,
  EmulatorSaveLocationStatus,
} from "@types";
import {
  discCloudSaveEmulatorSystem,
  type DiscCloudSaveEmulatorProvider,
} from "../../../../../shared/cloud-save-emulator-provider.js";
import type { CloudSaveSnapshotPanelMode } from "./cloud-save-presentation";
import type { RetroArchExecutableStatus } from "./retroarch-executable-status";

export const emulatorConfigSettingsUrl = (
  provider: DiscCloudSaveEmulatorProvider
) =>
  `/settings?tab=emulation&system=${discCloudSaveEmulatorSystem(provider)}&section=emulator`;

export type EmulatorConfigCheckStatus =
  | EmulatorSaveLocationStatus["status"]
  | "checking"
  | "error";

export const shouldShowDiscIdentityCard = (
  requiresDisc: boolean,
  status: EmulatorDiscIdentityStatus | null | undefined,
  remoteIdentityError: boolean,
  isSyncing: boolean
) =>
  requiresDisc &&
  !isSyncing &&
  (remoteIdentityError ||
    (!!status && status.status !== "ready" && status.status !== "missing"));

const needsEmulatorConfig = (
  status: EmulatorConfigCheckStatus | null | undefined
): status is Exclude<EmulatorConfigCheckStatus, "ready" | "checking"> =>
  !!status && status !== "ready" && status !== "checking";

export const getEmulatorConfigWarningKey = (
  provider: DiscCloudSaveEmulatorProvider | null | undefined,
  status: EmulatorConfigCheckStatus | null | undefined
) =>
  provider && needsEmulatorConfig(status)
    ? `cloud_save_v2_${provider}_config_${status}`
    : null;

export const discIdentityKey = (
  provider: DiscCloudSaveEmulatorProvider,
  suffix: string
) => `cloud_save_v2_${provider}_identity_${suffix}`;

export const getCloudSavePanelMode = (
  hasMediaPath: boolean,
  emulatorConfigStatus: EmulatorConfigCheckStatus | null | undefined,
  snapshotMode: CloudSaveSnapshotPanelMode,
  isSyncing: boolean,
  retroArchExecutableStatus: RetroArchExecutableStatus | null = null
):
  | CloudSaveSnapshotPanelMode
  | "missing-executable"
  | "emulator-config"
  | "retroarch-config" => {
  if (isSyncing) return snapshotMode;
  if (
    retroArchExecutableStatus === "checking" ||
    emulatorConfigStatus === "checking"
  )
    return "skeleton";
  if (retroArchExecutableStatus && retroArchExecutableStatus !== "ready")
    return "retroarch-config";
  if (needsEmulatorConfig(emulatorConfigStatus)) return "emulator-config";
  if (!hasMediaPath) return "missing-executable";
  return snapshotMode;
};
