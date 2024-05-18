import Skeleton from "react-loading-skeleton";

export function SeedersAndPeersSkeleton() {
  return (
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
  );
}
