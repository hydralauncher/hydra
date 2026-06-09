import cn from "classnames";
import type { CSSProperties, HTMLAttributes } from "react";

import "./styles.scss";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  shimmerDurationMs?: number;
}

export function Skeleton({
  className,
  shimmerDurationMs = 2800,
  style,
  ...props
}: Readonly<SkeletonProps>) {
  return (
    <div
      className={cn("skeleton", className)}
      aria-hidden="true"
      style={
        {
          "--skeleton-shimmer-duration": `${shimmerDurationMs}ms`,
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  );
}
