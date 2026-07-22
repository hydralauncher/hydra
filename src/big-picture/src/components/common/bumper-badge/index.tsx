import "./styles.scss";

import cn from "classnames";

interface BumperBadgeProps {
  label: "LB" | "RB";
  className?: string;
}

export function BumperBadge({ label, className }: Readonly<BumperBadgeProps>) {
  return (
    <span className={cn("bumper-badge", className)} aria-hidden="true">
      {label}
    </span>
  );
}
