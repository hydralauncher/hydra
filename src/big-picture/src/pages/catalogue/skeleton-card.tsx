import { Skeleton } from "../../components";

export function CatalogueSkeletonCard() {
  return (
    <div className="catalogue-skeleton">
      <Skeleton className="catalogue-skeleton__image" />

      <div className="catalogue-skeleton__content">
        <Skeleton style={{ width: "70%", height: 20 }} />
        <Skeleton style={{ width: "50%", height: 18 }} />
      </div>
    </div>
  );
}

