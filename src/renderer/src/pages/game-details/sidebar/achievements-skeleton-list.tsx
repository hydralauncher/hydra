import Skeleton from "react-loading-skeleton";

const SKELETON_ITEMS = Array.from(
  { length: 4 },
  (_, index) => `achievement-skeleton-${index}`
);

/**
 * Placeholder for the sidebar's achievement list: four rows and the
 * "see all" link, the same height as the loaded list.
 */
export function AchievementsSkeletonList() {
  return (
    <ul className="list" aria-busy="true">
      {SKELETON_ITEMS.map((key) => (
        <li key={key}>
          <div className="list__item list__item--skeleton">
            <Skeleton height={54} width={54} style={{ borderRadius: "4px" }} />
            <div>
              <Skeleton
                height={14}
                width={120}
                style={{ marginBottom: "4px" }}
              />
              <Skeleton height={12} width={80} />
            </div>
          </div>
        </li>
      ))}
      <Skeleton height={20} width={140} />
    </ul>
  );
}
