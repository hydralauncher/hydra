import { Skeleton } from "../../common";

import "./styles.scss";

export function DownloadSourceOptionSkeleton() {
  return (
    <Skeleton
      className="download-source-option-skeleton"
      shimmerDurationMs={2800}
    />
  );
}
