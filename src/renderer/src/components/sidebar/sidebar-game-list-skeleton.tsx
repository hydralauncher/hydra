import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

const SKELETON_ITEM_COUNT = 16;

export function SidebarGameListSkeleton() {
  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <ul className="sidebar__game-list-skeleton" aria-hidden="true">
        {Array.from({ length: SKELETON_ITEM_COUNT }, (_, index) => (
          <li key={index} className="sidebar__game-skeleton">
            <Skeleton
              width={20}
              height={20}
              borderRadius={4}
              containerClassName="sidebar__game-skeleton-icon"
            />
            <Skeleton
              height={12}
              borderRadius={4}
              containerClassName="sidebar__game-skeleton-title"
            />
          </li>
        ))}
      </ul>
    </SkeletonTheme>
  );
}
