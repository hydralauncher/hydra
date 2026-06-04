import cn from "classnames";
import { Skeleton } from "../../common";

import "./styles.scss";

const sizes = {
  small: "source-anchor--small",
  medium: "source-anchor--medium",
  large: "source-anchor--large",
};

export interface SourceAnchorSkeletonProps {
  size?: keyof typeof sizes;
}

export function SourceAnchorSkeleton({
  size = "medium",
}: Readonly<SourceAnchorSkeletonProps>) {
  return (
    <Skeleton
      className={cn("source-anchor", "source-anchor-skeleton", sizes[size])}
      shimmerDurationMs={2800}
    />
  );
}
