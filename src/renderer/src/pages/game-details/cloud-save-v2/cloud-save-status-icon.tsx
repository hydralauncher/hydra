import {
  CircleNotchIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudIcon,
  CloudSlashIcon,
  CloudWarningIcon,
} from "@phosphor-icons/react";

import type { CloudSaveOverview, CloudSaveSyncProgressPayload } from "@types";

interface CloudSaveStatusIconProps {
  overview: CloudSaveOverview | null;
  isChecking?: boolean;
  isSyncing?: boolean;
  hasError?: boolean;
  isAvailable?: boolean;
  hasExecutablePath?: boolean;
  progress?: CloudSaveSyncProgressPayload | null;
  size?: number;
}

export function CloudSaveStatusIcon({
  overview,
  isChecking = false,
  isSyncing = false,
  hasError = false,
  isAvailable = true,
  hasExecutablePath = true,
  progress = null,
  size = 22,
}: Readonly<CloudSaveStatusIconProps>) {
  if (!isAvailable || !hasExecutablePath) {
    return <CloudSlashIcon size={size} weight="fill" />;
  }
  if (hasError) return <CloudSlashIcon size={size} weight="fill" />;
  if (progress?.stage === "uploading") {
    return <CloudArrowUpIcon size={size} weight="fill" />;
  }
  if (progress?.stage === "restoring") {
    return <CloudArrowDownIcon size={size} weight="fill" />;
  }
  if (isChecking || isSyncing) {
    return <CircleNotchIcon className="cloud-save-v2__spinner" size={size} />;
  }
  if (overview?.state === "synced") {
    return <CloudCheckIcon size={size} weight="fill" />;
  }
  if (
    overview?.state === "conflict" ||
    overview?.state === "local-ahead" ||
    overview?.state === "remote-ahead"
  ) {
    return <CloudWarningIcon size={size} weight="fill" />;
  }

  return <CloudIcon size={size} weight="fill" />;
}
