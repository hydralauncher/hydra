import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameReview, GameShop } from "@types";
import "./bp-reviews-section.scss";

type ReviewSortOption = "newest" | "oldest" | "score_high";

interface BpReviewsSectionProps {
  shop: GameShop;
  objectId: string;
}

export function BpReviewsSection({
  shop,
  objectId,
}: Readonly<BpReviewsSectionProps>) {
  const { t } = useTranslation("big_picture");

  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<ReviewSortOption>("newest");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadReviews = useCallback(
    async (reset = false) => {
      if (!objectId || shop === "custom") return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setLoading(true);
      try {
        const skip = reset ? 0 : page * 20;
        const params = new URLSearchParams({
          take: "20",
          skip: skip.toString(),
          sortBy,
        });

        const response = await window.electron.hydraApi.get(
          `/games/${shop}/${objectId}/reviews?${params.toString()}`,
          { needsAuth: false }
        );

        if (abortController.signal.aborted) return;

        const typedResponse = response as unknown as
          | { reviews: GameReview[]; totalCount: number }
          | undefined;
        const reviewsData = typedResponse?.reviews || [];
        const reviewCount = typedResponse?.totalCount || 0;

        if (reset) {
          setReviews(reviewsData);
          setPage(0);
          setTotalCount(reviewCount);
        } else {
          setReviews((prev) => [...prev, ...reviewsData]);
        }

        setHasMore(reviewsData.length === 20);
      } catch {
        /* ignore aborted requests */
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [objectId, shop, page, sortBy]
  );

  useEffect(() => {
    loadReviews(true);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [objectId, sortBy, loadReviews]);

  useEffect(() => {
    if (page > 0) {
      loadReviews(false);
    }
  }, [page, loadReviews]);

  const handleSortChange = (newSort: ReviewSortOption) => {
    if (newSort !== sortBy) {
      setSortBy(newSort);
      setPage(0);
      setHasMore(true);
    }
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      setPage((prev) => prev + 1);
    }
  };

  const formatPlaytime = (seconds?: number) => {
    if (!seconds) return null;
    const hours = Math.floor(seconds / 3600);
    if (hours > 0) return `${hours}h`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  };

  const renderStars = (score: number) => {
    const stars: string[] = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(i <= score ? "\u2605" : "\u2606");
    }
    return stars.join("");
  };

  return (
    <div className="bp-reviews">
      <div className="bp-reviews__header">
        <h2 className="bp-reviews__title">
          {t("reviews")}
          {totalCount > 0 && (
            <span className="bp-reviews__count">{totalCount}</span>
          )}
        </h2>

        <div className="bp-reviews__sort">
          {(["newest", "oldest", "score_high"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`bp-reviews__sort-btn ${
                sortBy === option ? "bp-reviews__sort-btn--active" : ""
              }`}
              data-bp-focusable
              onClick={() => handleSortChange(option)}
            >
              {t(`sort_${option}`)}
            </button>
          ))}
        </div>
      </div>

      {loading && reviews.length === 0 && (
        <div className="bp-reviews__loading">{t("loading")}</div>
      )}

      {!loading && reviews.length === 0 && (
        <div className="bp-reviews__empty">{t("no_reviews")}</div>
      )}

      <div className="bp-reviews__list">
        {reviews.map((review) => (
          <div key={review.id} className="bp-reviews__card" data-bp-focusable>
            <div className="bp-reviews__card-header">
              <div className="bp-reviews__user">
                {review.user.profileImageUrl ? (
                  <img
                    src={review.user.profileImageUrl}
                    alt=""
                    className="bp-reviews__avatar"
                  />
                ) : (
                  <div className="bp-reviews__avatar bp-reviews__avatar--placeholder">
                    {review.user.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="bp-reviews__username">
                  {review.user.displayName}
                </span>
              </div>

              <div className="bp-reviews__meta">
                <span className="bp-reviews__stars">
                  {renderStars(review.score)}
                </span>
                {review.playTimeInSeconds != null && (
                  <span className="bp-reviews__playtime">
                    {formatPlaytime(review.playTimeInSeconds)}
                  </span>
                )}
              </div>
            </div>

            <div
              className="bp-reviews__content"
              dangerouslySetInnerHTML={{ __html: review.reviewHtml }}
            />

            <div className="bp-reviews__card-footer">
              <span className="bp-reviews__date">
                {new Date(review.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>

      {hasMore && !loading && (
        <button
          type="button"
          className="bp-reviews__load-more"
          data-bp-focusable
          onClick={handleLoadMore}
        >
          {t("load_more_reviews")}
        </button>
      )}

      {loading && reviews.length > 0 && (
        <div className="bp-reviews__loading">{t("loading")}</div>
      )}
    </div>
  );
}
