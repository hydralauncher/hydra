import { TrophyIcon, UserIcon } from "@phosphor-icons/react";
import type { UserDetails } from "@types";

export interface UserAchievementsSummaryProps {
  userDetails: UserDetails | null;
  unlockedCount: number;
  totalCount: number;
}

export function UserAchievementsSummary({
  userDetails,
  unlockedCount,
  totalCount,
}: Readonly<UserAchievementsSummaryProps>) {
  const percentage = totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0;
  const formattedPercentage =
    percentage === 0 || Number.isInteger(percentage)
      ? `${percentage}%`
      : `${percentage.toFixed(1)}%`;

  return (
    <div className="game-achievements-page__summary">
      <div className="game-achievements-page__summary-avatar">
        {userDetails?.profileImageUrl ? (
          <img
            src={userDetails.profileImageUrl}
            alt={userDetails.displayName}
            draggable={false}
          />
        ) : (
          <UserIcon size={32} />
        )}
      </div>

      <div className="game-achievements-page__summary-content">
        <div className="game-achievements-page__summary-row">
          <div className="game-achievements-page__summary-info">
            <p className="game-achievements-page__summary-name">
              {userDetails?.displayName ?? "Anonymous"}
            </p>
            <div className="game-achievements-page__summary-count">
              <TrophyIcon size={20} />
              <span>
                {unlockedCount} / {totalCount}
              </span>
            </div>
          </div>

          <span className="game-achievements-page__summary-percentage">
            {formattedPercentage}
          </span>
        </div>

        <div className="game-achievements-page__summary-progress">
          <div className="game-achievements-page__summary-progress-track" />
          <div
            className="game-achievements-page__summary-progress-fill"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
