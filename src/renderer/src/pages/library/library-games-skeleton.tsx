import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";
import type { ViewMode } from "./view-options";
import "./library-games-skeleton.scss";

interface LibraryGamesSkeletonProps {
  viewMode: ViewMode;
  columns: number;
  rows: number;
  gap: number;
}

export function LibraryGamesSkeleton({
  viewMode,
  columns,
  rows,
  gap,
}: Readonly<LibraryGamesSkeletonProps>) {
  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <div
        className="library-games-skeleton"
        aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gap }}
      >
        {Array.from({ length: columns * rows }, (_, index) => (
          <Skeleton
            key={index}
            containerClassName="library-games-skeleton__item"
            className={cn("library-games-skeleton__card", {
              "library-games-skeleton__card--large": viewMode === "large",
            })}
          />
        ))}
      </div>
    </SkeletonTheme>
  );
}
