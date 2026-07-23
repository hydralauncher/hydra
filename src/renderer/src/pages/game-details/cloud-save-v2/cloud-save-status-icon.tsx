import {
  CircleNotchIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudIcon,
  CloudSlashIcon,
  CloudWarningIcon,
  CloudXIcon,
} from "@phosphor-icons/react";

import type { CloudSavePresentationIcon } from "./cloud-save-presentation";

interface CloudSaveStatusIconProps {
  icon: CloudSavePresentationIcon;
  size?: number;
}

export function CloudSaveStatusIcon({
  icon,
  size = 22,
}: Readonly<CloudSaveStatusIconProps>) {
  switch (icon) {
    case "cloud-slash":
      return <CloudSlashIcon size={size} weight="fill" />;
    case "cloud-x":
      return <CloudXIcon size={size} weight="fill" />;
    case "spinner":
      return <CircleNotchIcon className="cloud-save-v2__spinner" size={size} />;
    case "upload":
      return <CloudArrowUpIcon size={size} weight="fill" />;
    case "restore":
      return <CloudArrowDownIcon size={size} weight="fill" />;
    case "synced":
      return <CloudCheckIcon size={size} weight="fill" />;
    case "warning":
      return <CloudWarningIcon size={size} weight="fill" />;
    case "cloud":
    default:
      return <CloudIcon size={size} weight="fill" />;
  }
}
