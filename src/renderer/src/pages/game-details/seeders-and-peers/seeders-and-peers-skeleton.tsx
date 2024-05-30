import { vars } from "@renderer/theme.css";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

export function SeedersAndPeersSkeleton() {
  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <div
        style={{
          display: "flex",
        }}
      >
        <Skeleton width={40} height={20} />
        <Skeleton
          width={40}
          height={20}
          style={{
            marginLeft: "12px",
          }}
        />
      </div>
    </SkeletonTheme>
  );
}
