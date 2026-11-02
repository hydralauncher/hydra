import cn from "classnames";

import "./hydra-cloud-badge.scss";

export interface HydraCloudBadgeProps {
  className?: string;
}

export function HydraCloudBadge({ className }: Readonly<HydraCloudBadgeProps>) {
  return (
    <span className={cn("hydra-cloud-badge", className)}>Hydra Cloud</span>
  );
}
