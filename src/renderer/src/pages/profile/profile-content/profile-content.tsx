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
  useAppSelector,
  useFormat,
  useUserDetails,
  useDominantColor,
} from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { useTranslation } from "react-i18next";
import type { GameShop } from "@types";
import {
  findSouvenirByNotificationTarget,
  isAchievementSouvenirsEnabled,
  useSouvenirContentWarning,
} from "@shared";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { FriendsBox, FriendsBoxAddButton } from "./friends-box";

import { RecentGamesBox } from "./recent-games-box";
import { UserStatsBox } from "./user-stats-box";
import { DeleteReviewModal } from "@renderer/pages/game-details/modals/delete-review-modal";
import { GAME_STATS_ANIMATION_DURATION_IN_MS } from "./profile-animations";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { ProfileTabs, type ProfileTabType } from "./profile-tabs";
import { LibraryTab } from "./library-tab";
import { ReviewsTab } from "./reviews-tab";
import { AnimatePresence, motion } from "framer-motion";
import { SouvenirsTab } from "./souvenirs-tab";
import { SouvenirLightbox } from "./souvenir-lightbox";
import { useSouvenirActions } from "./use-souvenir-actions";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConfirmationModal } from "@renderer/components";
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
  translations: {
    [key: string]: string;
  };
  detectedLanguage: string | null;
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
    backgroundImage,
    souvenirs,
    souvenirsTotal,
    souvenirsHiddenReason,
    hasMoreSouvenirs,
    isLoadingSouvenirs,
    getUserSouvenirs,
    loadMoreSouvenirs,
    updateSouvenir,
    removeSouvenir,
  } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedSouvenir = searchParams.get("souvenir");
  const attemptedDeepLinkPagesRef = useRef(new Set<string>());
  const souvenirsEnabled = useAppSelector((state) =>
    isAchievementSouvenirsEnabled(
      state.userPreferences.value?.enableAchievementSouvenirs,
      window.electron.platform
    )
  );
  const disableNsfwAlert = useAppSelector(
    (state) => state.userPreferences.value?.disableNsfwAlert === true
  );
  const [statsIndex, setStatsIndex] = useState(0);
  const [isAnimationRunning, setIsAnimationRunning] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>("playedRecently");
  const statsAnimation = useRef(-1);

  const [activeTab, setActiveTab] = useState<ProfileTabType>(
    requestedTab === "souvenirs" ? "souvenirs" : "library"
  );

  // User reviews state
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [reviewsTotalCount, setReviewsTotalCount] = useState(0);
  const [votingReviews, setVotingReviews] = useState<Set<string>>(new Set());

  const { isLight } = useDominantColor(backgroundImage);
  const isBgLight = isLight ?? false;

  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [reviewToDelete, setReviewToDelete] = useState<string | null>(null);

  const dispatch = useAppDispatch();

  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();
  const {
    likingKeys,
    visibilityKeys,
    deletingKeys,
    reportingKeys,
    reportedKeys,
    likeSouvenir,
    changeSouvenirVisibility,
    deleteSouvenir,
    reportSouvenir,
  } = useSouvenirActions({
    ownerUserId: userProfile?.id,
    canLike: Boolean(userDetails),
    canReport: Boolean(userDetails) && !isMe,
    updateSouvenir,
    removeSouvenir,
  });
  const {
    openSouvenirKey,
    openSouvenirIndex,
    openSouvenir: souvenir,
    pendingSouvenir,
    requestOpenSouvenir,
    confirmContentWarning,
    dismissContentWarning,
    closeSouvenir,
  } = useSouvenirContentWarning({
    souvenirs,
    disableNsfwAlert,
    ownerUserId: userProfile?.id,
  });

  const clearRequestedSouvenir = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("souvenir");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    attemptedDeepLinkPagesRef.current.clear();
  }, [requestedSouvenir, userProfile?.id]);

  useEffect(() => {
    if (!requestedSouvenir || !userProfile?.id) return;

    setActiveTab("souvenirs");
    const normalizedTarget = requestedSouvenir.toLowerCase();
    const match = findSouvenirByNotificationTarget(
      souvenirs,
      requestedSouvenir
    );

    if (match) {
      requestOpenSouvenir(match);
      clearRequestedSouvenir();
      return;
    }

    if (isLoadingSouvenirs) return;
    const pageKey = `${normalizedTarget}:${souvenirs.length}`;
    if (hasMoreSouvenirs && !attemptedDeepLinkPagesRef.current.has(pageKey)) {
      attemptedDeepLinkPagesRef.current.add(pageKey);
      void loadMoreSouvenirs("recent");
      return;
    }

    clearRequestedSouvenir();
  }, [
    clearRequestedSouvenir,
    hasMoreSouvenirs,
    isLoadingSouvenirs,
    loadMoreSouvenirs,
    requestOpenSouvenir,
    requestedSouvenir,
    souvenirs,
    userProfile?.id,
  ]);

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
    if (userProfile?.id) {
      // When sortBy changes, clear animated games so all games animate in
      if (currentSortByRef.current !== sortBy) {
        animatedGameIdsRef.current.clear();
        currentSortByRef.current = sortBy;
      }
      getUserLibraryGames(sortBy, true);
    }
  }, [sortBy, getUserLibraryGames, userProfile?.id]);

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
    setActiveTab(requestedTab === "souvenirs" ? "souvenirs" : "library");
  }, [requestedTab, userProfile?.id]);

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

    return (
      <section className="profile-content__section">
        <div
          className="profile-content__main"
          style={{ gap: 24, display: "flex", flexDirection: "column" }}
        >
          <div className="profile-content__tab-panels">
            <AnimatePresence mode="wait">
              {activeTab === "library" && (
                <LibraryTab
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                  pinnedGames={pinnedGames}
                  libraryGames={libraryGames}
                  hasMoreLibraryGames={hasMoreLibraryGames}
                  isLoadingLibraryGames={isLoadingLibraryGames}
                  statsIndex={statsIndex}
                  userStats={userStats}
                  animatedGameIdsRef={animatedGameIdsRef}
                  onLoadMore={handleLoadMore}
                  onMouseEnter={handleOnMouseEnterGameCard}
                  onMouseLeave={handleOnMouseLeaveGameCard}
                  isMe={isMe}
                />
              )}

              {activeTab === "reviews" && (
                <ReviewsTab
                  reviews={reviews}
                  isLoadingReviews={isLoadingReviews}
                  votingReviews={votingReviews}
                  userDetailsId={userDetails?.id}
                  formatPlayTime={formatPlayTime}
                  getRatingText={getRatingText}
                  onVote={handleVoteReview}
                  onDelete={handleDeleteClick}
                />
              )}

              {activeTab === "stats" && userStats && <UserStatsBox />}

              {activeTab === "friends" &&
                ((userProfile.friends?.length ?? 0) > 0 || isMe) && (
                  <motion.div
                    key="friends"
                    className="profile-content__tab-panel"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="profile-content__section-header">
                      <div className="profile-content__section-title-group">
                        <h2>{t("friends", { defaultValue: "Amigos" })}</h2>
                        <span className="profile-content__section-badge">
                          {userProfile.friends?.length || 0}
                        </span>
                      </div>
                    </div>
                    {isMe && (
                      <>
                        <FriendsBoxAddButton />
                        <div style={{ marginTop: 16 }} />
                      </>
                    )}
                    <FriendsBox />
                  </motion.div>
                )}

              {activeTab === "activity" &&
                (userProfile.recentGames?.length ?? 0) > 0 && (
                  <motion.div
                    key="activity"
                    className="profile-content__tab-panel"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="profile-content__section-header">
                      <div className="profile-content__section-title-group">
                        <h2>{t("activity", { defaultValue: "Atividade" })}</h2>
                        <span className="profile-content__section-badge">
                          {userProfile.recentGames?.length || 0}
                        </span>
                      </div>
                    </div>
                    <RecentGamesBox />
                  </motion.div>
                )}

              {activeTab === "souvenirs" && (
                <SouvenirsTab
                  achievements={souvenirs}
                  hiddenReason={souvenirsHiddenReason}
                  canLike={Boolean(userDetails)}
                  hasMore={hasMoreSouvenirs}
                  isLoading={isLoadingSouvenirs}
                  isEnabled={souvenirsEnabled}
                  isMe={isMe}
                  userId={userProfile.id}
                  visibility={userProfile.souvenirsVisibility}
                  hasActiveSubscription={Boolean(
                    userProfile.hasActiveSubscription
                  )}
                  disableNsfwAlert={disableNsfwAlert}
                  likingKeys={likingKeys}
                  onSouvenirClick={requestOpenSouvenir}
                  onLikeClick={(item) => void likeSouvenir(item)}
                  onReload={getUserSouvenirs}
                  onLoadMore={loadMoreSouvenirs}
                  onOpenSettings={() =>
                    navigate(
                      "/settings?tab=content_gameplay#achievement-souvenirs"
                    )
                  }
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        {isMe && <ReportProfile />}

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
    reviews,
    reviewsTotalCount,
    isLoadingReviews,
    votingReviews,
    deleteModalVisible,
  ]);

  return (
    <div>
      <ProfileHero>
        <ProfileTabs
          activeTab={activeTab}
          reviewsTotalCount={reviewsTotalCount}
          souvenirsCount={souvenirsTotal}
          onTabChange={setActiveTab}
          showFriendsTab={(userProfile?.friends?.length ?? 0) > 0 || isMe}
          showActivityTab={(userProfile?.recentGames?.length ?? 0) > 0}
          isBgLight={isBgLight}
        />
      </ProfileHero>
      {content}

      <SouvenirLightbox
        souvenir={souvenir}
        items={souvenirs}
        index={openSouvenirIndex}
        isOwner={isMe}
        canLike={Boolean(userDetails)}
        isLiking={Boolean(openSouvenirKey && likingKeys.has(openSouvenirKey))}
        isUpdatingVisibility={Boolean(
          openSouvenirKey && visibilityKeys.has(openSouvenirKey)
        )}
        isDeleting={Boolean(
          openSouvenirKey && deletingKeys.has(openSouvenirKey)
        )}
        isReporting={Boolean(
          openSouvenirKey && reportingKeys.has(openSouvenirKey)
        )}
        isReported={Boolean(
          openSouvenirKey && reportedKeys.has(openSouvenirKey)
        )}
        isContentWarningVisible={Boolean(pendingSouvenir)}
        onClose={closeSouvenir}
        onNavigate={(index) => {
          const nextSouvenir = souvenirs[index];
          return nextSouvenir ? requestOpenSouvenir(nextSouvenir) : false;
        }}
        onLike={(item) => void likeSouvenir(item)}
        onVisibilityChange={(item) => void changeSouvenirVisibility(item)}
        onDelete={deleteSouvenir}
        onReport={reportSouvenir}
      />

      <ConfirmationModal
        visible={Boolean(pendingSouvenir)}
        title={t("souvenir_content_warning_title")}
        descriptionText={t("souvenir_content_warning_description", {
          title: pendingSouvenir?.gameTitle ?? t("unknown_game"),
        })}
        confirmButtonLabel={t("allow_nsfw_content", {
          ns: "game_details",
        })}
        cancelButtonLabel={t("refuse_nsfw_content", {
          ns: "game_details",
        })}
        onConfirm={confirmContentWarning}
        onClose={dismissContentWarning}
        clickOutsideToClose={false}
      />
    </div>
  );
}
