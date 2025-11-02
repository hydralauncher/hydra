import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ProfileReviewItem } from "./profile-review-item";
import "./profile-content.scss";

interface UserReview {
  id: string;
  reviewHtml: string;
  score: number;
  playTimeInSeconds?: number;
  upvotes: number;
  downvotes: number;
  hasUpvoted: boolean;
  hasDownvoted: boolean;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
  };
  game: {
    title: string;
    iconUrl: string;
    objectId: string;
    shop: string;
  };
}

interface ReviewsTabProps {
  reviews: UserReview[];
  isLoadingReviews: boolean;
  votingReviews: Set<string>;
  userDetailsId?: string;
  formatPlayTime: (playTimeInSeconds: number) => string;
  getRatingText: (score: number, t: (key: string) => string) => string;
  onVote: (reviewId: string, isUpvote: boolean) => void;
  onDelete: (reviewId: string) => void;
}

export function ReviewsTab({
  reviews,
  isLoadingReviews,
  votingReviews,
  userDetailsId,
  formatPlayTime,
  getRatingText,
  onVote,
  onDelete,
}: Readonly<ReviewsTabProps>) {
  const { t } = useTranslation("user_profile");

  return (
    <motion.div
      key="reviews"
      className="profile-content__tab-panel"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.2 }}
      aria-hidden={false}
    >
      {isLoadingReviews && (
        <div className="user-reviews__loading">{t("loading_reviews")}</div>
      )}
      {!isLoadingReviews && reviews.length === 0 && (
        <div className="user-reviews__empty">
          <p>{t("no_reviews", "No reviews yet")}</p>
        </div>
      )}
      {!isLoadingReviews && reviews.length > 0 && (
        <div className="user-reviews__list">
          {reviews.map((review) => {
            const isOwnReview = userDetailsId === review.user.id;

            return (
              <ProfileReviewItem
                key={review.id}
                review={review}
                isOwnReview={isOwnReview}
                isVoting={votingReviews.has(review.id)}
                formatPlayTime={formatPlayTime}
                getRatingText={getRatingText}
                onVote={onVote}
                onDelete={onDelete}
              />
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

