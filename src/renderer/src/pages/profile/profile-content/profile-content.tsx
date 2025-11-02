import { userProfileContext } from "@renderer/context";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProfileHero } from "../profile-hero/profile-hero";
import {
  useAppDispatch,
  useFormat,
  useDate,
  useUserDetails,
} from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { TelescopeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { FriendsBox } from "./friends-box";
import { RecentGamesBox } from "./recent-games-box";
import { UserStatsBox } from "./user-stats-box";
import { UserKarmaBox } from "./user-karma-box";
import { UserLibraryGameCard } from "./user-library-game-card";
import { SortOptions } from "./sort-options";

import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";
import { ClockIcon } from "@primer/octicons-react";
import { Star, ThumbsUp, ThumbsDown, TrashIcon } from "lucide-react";
import type { GameShop } from "@types";
import { DeleteReviewModal } from "@renderer/pages/game-details/modals/delete-review-modal";
import { GAME_STATS_ANIMATION_DURATION_IN_MS } from "./profile-animations";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import InfiniteScroll from "react-infinite-scroll-component";
import "./profile-content.scss";

type SortOption = "playtime" | "achievementCount" | "playedRecently";

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
    shop: GameShop;
  };
}

interface UserReviewsResponse {
  totalCount: number;
  reviews: UserReview[];
}

const getRatingText = (score: number, t: (key: string) => string): string => {
  switch (score) {
    case 1:
      return t("rating_very_negative");
    case 2:
      return t("rating_negative");
    case 3:
      return t("rating_neutral");
    case 4:
      return t("rating_positive");
    case 5:
      return t("rating_very_positive");
    default:
      return "";
  }
};

export function ProfileContent() {
  const {
    userProfile,
    isMe,
    userStats,
    libraryGames,
    pinnedGames,
    getUserLibraryGames,
    loadMoreLibraryGames,
    hasMoreLibraryGames,
    isLoadingLibraryGames,
  } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { formatDistance } = useDate();
  const navigate = useNavigate();
  const [statsIndex, setStatsIndex] = useState(0);
  const [isAnimationRunning, setIsAnimationRunning] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>("playedRecently");
  const statsAnimation = useRef(-1);

  const [activeTab, setActiveTab] = useState<"library" | "reviews">("library");

  // User reviews state
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [reviewsTotalCount, setReviewsTotalCount] = useState(0);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [votingReviews, setVotingReviews] = useState<Set<string>>(new Set());
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [reviewToDelete, setReviewToDelete] = useState<string | null>(null);

  const dispatch = useAppDispatch();

  const { t } = useTranslation("user_profile");
  const { t: tGameDetails } = useTranslation("game_details");
  const { numberFormatter } = useFormat();

  const formatPlayTime = (playTimeInSeconds: number) => {
    const minutes = playTimeInSeconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  };

  useEffect(() => {
    dispatch(setHeaderTitle(""));

    if (userProfile) {
      dispatch(setHeaderTitle(userProfile.displayName));
    }
  }, [userProfile, dispatch]);

  useEffect(() => {
    if (userProfile) {
      // When sortBy changes, clear animated games so all games animate in
      if (currentSortByRef.current !== sortBy) {
        animatedGameIdsRef.current.clear();
        currentSortByRef.current = sortBy;
      }
      getUserLibraryGames(sortBy, true);
    }
  }, [sortBy, getUserLibraryGames, userProfile]);

  const animatedGameIdsRef = useRef<Set<string>>(new Set());
  const currentSortByRef = useRef<SortOption>(sortBy);

  const handleLoadMore = useCallback(() => {
    if (
      activeTab === "library" &&
      hasMoreLibraryGames &&
      !isLoadingLibraryGames
    ) {
      loadMoreLibraryGames(sortBy);
    }
  }, [
    activeTab,
    hasMoreLibraryGames,
    isLoadingLibraryGames,
    loadMoreLibraryGames,
    sortBy,
  ]);

  // Clear reviews state and reset tab when switching users
  useEffect(() => {
    setReviews([]);
    setReviewsTotalCount(0);
    setIsLoadingReviews(false);
    setActiveTab("library");
  }, [userProfile?.id]);

  useEffect(() => {
    if (userProfile?.id) {
      fetchUserReviews();
    }
  }, [userProfile?.id]);

  const fetchUserReviews = async () => {
    if (!userProfile?.id) return;

    setIsLoadingReviews(true);
    try {
      const response = await window.electron.hydraApi.get<UserReviewsResponse>(
        `/users/${userProfile.id}/reviews`,
        { needsAuth: true }
      );
      setReviews(response.reviews);
      setReviewsTotalCount(response.totalCount);
    } catch (error) {
      console.error("Failed to fetch user reviews:", error);
    } finally {
      setIsLoadingReviews(false);
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    try {
      const reviewToDeleteObj = reviews.find(
        (review) => review.id === reviewId
      );
      if (!reviewToDeleteObj) return;

      await window.electron.hydraApi.delete(
        `/games/${reviewToDeleteObj.game.shop}/${reviewToDeleteObj.game.objectId}/reviews/${reviewId}`
      );
      // Remove the review from the local state
      setReviews((prev) => prev.filter((review) => review.id !== reviewId));
      setReviewsTotalCount((prev) => prev - 1);
    } catch (error) {
      console.error("Failed to delete review:", error);
    }
  };

  const handleDeleteClick = (reviewId: string) => {
    setReviewToDelete(reviewId);
    setDeleteModalVisible(true);
  };

  const handleDeleteConfirm = () => {
    if (reviewToDelete) {
      handleDeleteReview(reviewToDelete);
      setReviewToDelete(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteModalVisible(false);
    setReviewToDelete(null);
  };

  const handleVoteReview = async (reviewId: string, isUpvote: boolean) => {
    if (votingReviews.has(reviewId)) return;

    setVotingReviews((prev) => new Set(prev).add(reviewId));

    const review = reviews.find((r) => r.id === reviewId);
    if (!review) {
      setVotingReviews((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
      return;
    }

    const wasUpvoted = review.hasUpvoted;
    const wasDownvoted = review.hasDownvoted;

    // Optimistic update
    setReviews((prev) =>
      prev.map((r) => {
        if (r.id !== reviewId) return r;

        let newUpvotes = r.upvotes;
        let newDownvotes = r.downvotes;
        let newHasUpvoted = r.hasUpvoted;
        let newHasDownvoted = r.hasDownvoted;

        if (isUpvote) {
          if (wasUpvoted) {
            // Remove upvote
            newUpvotes--;
            newHasUpvoted = false;
          } else {
            // Add upvote
            newUpvotes++;
            newHasUpvoted = true;
            if (wasDownvoted) {
              // Remove downvote if it was downvoted
              newDownvotes--;
              newHasDownvoted = false;
            }
          }
        } else if (wasDownvoted) {
          // Remove downvote
          newDownvotes--;
          newHasDownvoted = false;
        } else {
          // Add downvote
          newDownvotes++;
          newHasDownvoted = true;
          if (wasUpvoted) {
            // Remove upvote if it was upvoted
            newUpvotes--;
            newHasUpvoted = false;
          }
        }

        return {
          ...r,
          upvotes: newUpvotes,
          downvotes: newDownvotes,
          hasUpvoted: newHasUpvoted,
          hasDownvoted: newHasDownvoted,
        };
      })
    );

    try {
      const endpoint = isUpvote ? "upvote" : "downvote";
      await window.electron.hydraApi.put(
        `/games/${review.game.shop}/${review.game.objectId}/reviews/${reviewId}/${endpoint}`
      );
    } catch (error) {
      console.error("Failed to vote on review:", error);

      // Rollback optimistic update on error
      setReviews((prev) =>
        prev.map((r) => {
          if (r.id !== reviewId) return r;
          return {
            ...r,
            upvotes: review.upvotes,
            downvotes: review.downvotes,
            hasUpvoted: review.hasUpvoted,
            hasDownvoted: review.hasDownvoted,
          };
        })
      );
    } finally {
      setTimeout(() => {
        setVotingReviews((prev) => {
          const newSet = new Set(prev);
          newSet.delete(reviewId);
          return newSet;
        });
      }, 500);
    }
  };

  const handleOnMouseEnterGameCard = () => {
    setIsAnimationRunning(false);
  };

  const handleOnMouseLeaveGameCard = () => {
    setIsAnimationRunning(true);
  };

  useEffect(() => {
    let zero = performance.now();
    if (!isAnimationRunning) return;

    statsAnimation.current = requestAnimationFrame(
      function animateGameStats(time) {
        if (time - zero <= GAME_STATS_ANIMATION_DURATION_IN_MS) {
          statsAnimation.current = requestAnimationFrame(animateGameStats);
        } else {
          setStatsIndex((index) => index + 1);
          zero = performance.now();
          statsAnimation.current = requestAnimationFrame(animateGameStats);
        }
      }
    );

    return () => {
      cancelAnimationFrame(statsAnimation.current);
    };
  }, [setStatsIndex, isAnimationRunning]);

  const usersAreFriends = useMemo(() => {
    return userProfile?.relation?.status === "ACCEPTED";
  }, [userProfile]);

  const content = useMemo(() => {
    if (!userProfile) return null;

    const shouldLockProfile =
      userProfile.profileVisibility === "PRIVATE" ||
      (userProfile.profileVisibility === "FRIENDS" && !usersAreFriends);

    if (!isMe && shouldLockProfile) {
      return <LockedProfile />;
    }

    const hasGames = libraryGames.length > 0;
    const hasPinnedGames = pinnedGames.length > 0;
    const hasAnyGames = hasGames || hasPinnedGames;

    const shouldShowRightContent =
      hasAnyGames || userProfile.friends.length > 0;

    return (
      <section className="profile-content__section">
        <div className="profile-content__main">
          <div className="profile-content__tabs">
            <div className="profile-content__tab-wrapper">
              <button
                type="button"
                className={`profile-content__tab ${activeTab === "library" ? "profile-content__tab--active" : ""}`}
                onClick={() => setActiveTab("library")}
              >
                {t("library")}
              </button>
              {activeTab === "library" && (
                <motion.div
                  className="profile-content__tab-underline"
                  layoutId="tab-underline"
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                  }}
                />
              )}
            </div>
            <div className="profile-content__tab-wrapper">
              <button
                type="button"
                className={`profile-content__tab ${activeTab === "reviews" ? "profile-content__tab--active" : ""}`}
                onClick={() => setActiveTab("reviews")}
              >
                {t("user_reviews")}
                {reviewsTotalCount > 0 && (
                  <span className="profile-content__tab-badge">
                    {reviewsTotalCount}
                  </span>
                )}
              </button>
              {activeTab === "reviews" && (
                <motion.div
                  className="profile-content__tab-underline"
                  layoutId="tab-underline"
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                  }}
                />
              )}
            </div>
          </div>

          <div className="profile-content__tab-panels">
            <AnimatePresence mode="wait">
              {activeTab === "library" && (
                <motion.div
                  key="library"
                  className="profile-content__tab-panel"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  aria-hidden={false}
                >
                  {hasAnyGames && (
                    <SortOptions sortBy={sortBy} onSortChange={setSortBy} />
                  )}

                  {!hasAnyGames && (
                    <div className="profile-content__no-games">
                      <div className="profile-content__telescope-icon">
                        <TelescopeIcon size={24} />
                      </div>
                      <h2>{t("no_recent_activity_title")}</h2>
                      {isMe && <p>{t("no_recent_activity_description")}</p>}
                    </div>
                  )}

                  {hasAnyGames && (
                    <div>
                      {hasPinnedGames && (
                        <div style={{ marginBottom: "2rem" }}>
                          <div className="profile-content__section-header">
                            <div className="profile-content__section-title-group">
                              {/* removed collapse button */}
                              <h2>{t("pinned")}</h2>
                              <span className="profile-content__section-badge">
                                {pinnedGames.length}
                              </span>
                            </div>
                          </div>

                          {/* render pinned games unconditionally */}
                          <ul className="profile-content__games-grid">
                            {pinnedGames?.map((game) => (
                              <li
                                key={game.objectId}
                                style={{ listStyle: "none" }}
                              >
                                <UserLibraryGameCard
                                  game={game}
                                  statIndex={statsIndex}
                                  onMouseEnter={handleOnMouseEnterGameCard}
                                  onMouseLeave={handleOnMouseLeaveGameCard}
                                  sortBy={sortBy}
                                />
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {hasGames && (
                        <div>
                          <div className="profile-content__section-header">
                            <div className="profile-content__section-title-group">
                              <h2>{t("library")}</h2>
                              {userStats && (
                                <span className="profile-content__section-badge">
                                  {numberFormatter.format(
                                    userStats.libraryCount
                                  )}
                                </span>
                              )}
                            </div>
                          </div>

                          <InfiniteScroll
                            dataLength={libraryGames.length}
                            next={handleLoadMore}
                            hasMore={hasMoreLibraryGames}
                            loader={null}
                            scrollThreshold={0.9}
                            style={{ overflow: "visible" }}
                            scrollableTarget="scrollableDiv"
                          >
                            <ul className="profile-content__games-grid">
                              {libraryGames?.map((game, index) => {
                                const hasAnimated =
                                  animatedGameIdsRef.current.has(game.objectId);
                                const isNewGame =
                                  !hasAnimated && !isLoadingLibraryGames;

                                return (
                                  <motion.li
                                    key={`${sortBy}-${game.objectId}`}
                                    style={{ listStyle: "none" }}
                                    initial={
                                      isNewGame
                                        ? { opacity: 0.5, y: 15, scale: 0.96 }
                                        : false
                                    }
                                    animate={
                                      isNewGame
                                        ? { opacity: 1, y: 0, scale: 1 }
                                        : false
                                    }
                                    transition={
                                      isNewGame
                                        ? {
                                            duration: 0.15,
                                            ease: "easeOut",
                                            delay: index * 0.01,
                                          }
                                        : undefined
                                    }
                                    onAnimationComplete={() => {
                                      if (isNewGame) {
                                        animatedGameIdsRef.current.add(
                                          game.objectId
                                        );
                                      }
                                    }}
                                  >
                                    <UserLibraryGameCard
                                      game={game}
                                      statIndex={statsIndex}
                                      onMouseEnter={handleOnMouseEnterGameCard}
                                      onMouseLeave={handleOnMouseLeaveGameCard}
                                      sortBy={sortBy}
                                    />
                                  </motion.li>
                                );
                              })}
                            </ul>
                          </InfiniteScroll>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === "reviews" && (
                <motion.div
                  key="reviews"
                  className="profile-content__tab-panel"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  aria-hidden={false}
                >
                  {/* render reviews content unconditionally */}
                  {isLoadingReviews && (
                    <div className="user-reviews__loading">
                      {t("loading_reviews")}
                    </div>
                  )}
                  {!isLoadingReviews && reviews.length === 0 && (
                    <div className="user-reviews__empty">
                      <p>{t("no_reviews", "No reviews yet")}</p>
                    </div>
                  )}
                  {!isLoadingReviews && reviews.length > 0 && (
                    <div className="user-reviews__list">
                      {reviews.map((review) => {
                        const isOwnReview = userDetails?.id === review.user.id;

                        return (
                          <motion.div
                            key={review.id}
                            className="user-reviews__review-item"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3 }}
                          >
                            <div className="user-reviews__review-header">
                              <div className="user-reviews__review-meta-row">
                                <div
                                  className="user-reviews__review-score-stars"
                                  title={getRatingText(
                                    review.score,
                                    tGameDetails
                                  )}
                                >
                                  <Star
                                    size={12}
                                    className="user-reviews__review-star user-reviews__review-star--filled"
                                  />
                                  <span className="user-reviews__review-score-text">
                                    {review.score}/5
                                  </span>
                                </div>
                                {Boolean(
                                  review.playTimeInSeconds &&
                                    review.playTimeInSeconds > 0
                                ) && (
                                  <div className="user-reviews__review-playtime">
                                    <ClockIcon size={12} />
                                    <span>
                                      {tGameDetails("review_played_for")}{" "}
                                      {formatPlayTime(
                                        review.playTimeInSeconds || 0
                                      )}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="user-reviews__review-date">
                                {formatDistance(
                                  new Date(review.createdAt),
                                  new Date(),
                                  { addSuffix: true }
                                )}
                              </div>
                            </div>

                            <div
                              className="user-reviews__review-content"
                              dangerouslySetInnerHTML={{
                                __html: review.reviewHtml,
                              }}
                            />

                            <div className="user-reviews__review-footer">
                              <div className="user-reviews__review-game">
                                <div className="user-reviews__game-info">
                                  <div className="user-reviews__game-details">
                                    <img
                                      src={review.game.iconUrl}
                                      alt={review.game.title}
                                      className="user-reviews__game-icon"
                                    />
                                    <button
                                      className="user-reviews__game-title user-reviews__game-title--clickable"
                                      onClick={() =>
                                        navigate(
                                          buildGameDetailsPath(review.game)
                                        )
                                      }
                                    >
                                      {review.game.title}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="user-reviews__review-actions">
                              <div className="user-reviews__review-votes">
                                <motion.button
                                  className={`user-reviews__vote-button ${review.hasUpvoted ? "user-reviews__vote-button--active" : ""}`}
                                  onClick={() =>
                                    handleVoteReview(review.id, true)
                                  }
                                  disabled={votingReviews.has(review.id)}
                                  style={{
                                    opacity: votingReviews.has(review.id)
                                      ? 0.5
                                      : 1,
                                    cursor: votingReviews.has(review.id)
                                      ? "not-allowed"
                                      : "pointer",
                                  }}
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                >
                                  <ThumbsUp size={14} />
                                  <AnimatePresence mode="wait">
                                    <motion.span
                                      key={review.upvotes}
                                      initial={{ opacity: 0, y: -10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: 10 }}
                                      transition={{ duration: 0.2 }}
                                    >
                                      {review.upvotes}
                                    </motion.span>
                                  </AnimatePresence>
                                </motion.button>

                                <motion.button
                                  className={`user-reviews__vote-button ${review.hasDownvoted ? "user-reviews__vote-button--active" : ""}`}
                                  onClick={() =>
                                    handleVoteReview(review.id, false)
                                  }
                                  disabled={votingReviews.has(review.id)}
                                  style={{
                                    opacity: votingReviews.has(review.id)
                                      ? 0.5
                                      : 1,
                                    cursor: votingReviews.has(review.id)
                                      ? "not-allowed"
                                      : "pointer",
                                  }}
                                  whileHover={{ scale: 1.05 }}
                                  whileTap={{ scale: 0.95 }}
                                >
                                  <ThumbsDown size={14} />
                                  <AnimatePresence mode="wait">
                                    <motion.span
                                      key={review.downvotes}
                                      initial={{ opacity: 0, y: -10 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: 10 }}
                                      transition={{ duration: 0.2 }}
                                    >
                                      {review.downvotes}
                                    </motion.span>
                                  </AnimatePresence>
                                </motion.button>
                              </div>

                              {isOwnReview && (
                                <button
                                  className="user-reviews__delete-review-button"
                                  onClick={() => handleDeleteClick(review.id)}
                                  title={t("delete_review")}
                                >
                                  <TrashIcon size={14} />
                                  <span>{t("delete_review")}</span>
                                </button>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {shouldShowRightContent && (
          <div className="profile-content__right-content">
            <UserStatsBox />
            <UserKarmaBox />
            <RecentGamesBox />
            <FriendsBox />
            <ReportProfile />
          </div>
        )}

        <DeleteReviewModal
          visible={deleteModalVisible}
          onClose={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
        />
      </section>
    );
  }, [
    userProfile,
    isMe,
    usersAreFriends,
    userStats,
    numberFormatter,
    t,
    statsIndex,
    libraryGames,
    pinnedGames,

    sortBy,
    activeTab,
    // ensure reviews UI updates correctly
    reviews,
    reviewsTotalCount,
    isLoadingReviews,
    votingReviews,
    deleteModalVisible,
  ]);

  return (
    <div>
      <ProfileHero />

      {content}
    </div>
  );
}
