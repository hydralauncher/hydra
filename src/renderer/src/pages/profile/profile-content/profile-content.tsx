import { userProfileContext } from "@renderer/context";
import {
  getShopsForProfilePlatform,
  readStoredProfilePlatform,
  readStoredProfileSort,
  readStoredSouvenirSort,
} from "@renderer/helpers";
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
} from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { useTranslation } from "react-i18next";
import type { GameShop } from "@types";
import {
  AuthPage,
  findSouvenirByNotificationTarget,
  isAchievementSouvenirsEnabled,
  useSouvenirContentWarning,
} from "@shared";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { BadgesBox } from "./badges-box";
import { FriendsBox, FriendsBoxAddButton } from "./friends-box";
import { RecentGamesBox } from "./recent-games-box";
import { UserStatsBox } from "./user-stats-box";
import { ProfileSection } from "../profile-section/profile-section";
import { DeleteReviewModal } from "@renderer/pages/game-details/modals/delete-review-modal";
import { GAME_STATS_ANIMATION_DURATION_IN_MS } from "./profile-animations";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { ProfileTabs, type ProfileTabType } from "./profile-tabs";
import { LibraryTab } from "./library-tab";
import { ReviewsTab } from "./reviews-tab";
import { SouvenirsTab } from "./souvenirs-tab";
import { SouvenirLightbox } from "./souvenir-lightbox";
import { useSouvenirActions } from "./use-souvenir-actions";
import type { ProfilePlatform } from "./library-tab";
import { AnimatePresence } from "framer-motion";
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
    getUserStats,
    getUserLibraryGames,
    loadMoreLibraryGames,
    hasMoreLibraryGames,
    isLoadingLibraryGames,
    souvenirs,
    souvenirsTotal,
    hasReachedSouvenirLimit,
    souvenirsHiddenReason,
    hasMoreSouvenirs,
    isLoadingSouvenirs,
    getUserSouvenirs,
    loadMoreSouvenirs,
    updateSouvenir,
    removeSouvenir,
    loadedLibrarySortBy,
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
  const [sortBy, setSortBy] = useState<SortOption>(readStoredProfileSort);

  const prefetchedSortBy = useRef(readStoredProfileSort()).current;

  const handleSortChange = useCallback((nextSortBy: SortOption) => {
    setSortBy(nextSortBy);
    localStorage.setItem("profile-sort-by", nextSortBy);
  }, []);
  const [platform, setPlatform] = useState<ProfilePlatform>(
    readStoredProfilePlatform
  );

  const handlePlatformChange = useCallback((nextPlatform: ProfilePlatform) => {
    setPlatform(nextPlatform);
    localStorage.setItem("profile-platform", nextPlatform);
  }, []);
  const effectiveSortBy =
    !userProfile?.hasActiveSubscription && sortBy === "achievementCount"
      ? "playedRecently"
      : sortBy;

  const isCorrectingPrefetchedSort =
    Boolean(userProfile) &&
    sortBy === prefetchedSortBy &&
    effectiveSortBy !== prefetchedSortBy &&
    loadedLibrarySortBy !== effectiveSortBy;

  const shops = useMemo<string[]>(
    () => getShopsForProfilePlatform(platform),
    [platform]
  );

  const [activeTab, setActiveTab] = useState<ProfileTabType>(
    requestedTab === "souvenirs" ? "souvenirs" : "library"
  );

  // User reviews state
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [reviewsTotalCount, setReviewsTotalCount] = useState(0);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [votingReviews, setVotingReviews] = useState<Set<string>>(new Set());
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
      void loadMoreSouvenirs(readStoredSouvenirSort());
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
    if (userProfile) {
      getUserLibraryGames(effectiveSortBy, true, shops);
    }
  }, [effectiveSortBy, shops, getUserLibraryGames, userProfile]);

  useEffect(() => {
    if (userProfile) {
      getUserStats(shops);
    }
  }, [shops, getUserStats, userProfile]);

  const handleLoadMore = useCallback(() => {
    if (
      activeTab === "library" &&
      hasMoreLibraryGames &&
      !isLoadingLibraryGames
    ) {
      loadMoreLibraryGames(effectiveSortBy, shops);
    }
  }, [
    activeTab,
    hasMoreLibraryGames,
    isLoadingLibraryGames,
    loadMoreLibraryGames,
    effectiveSortBy,
    shops,
  ]);

  useEffect(() => {
    const handlePinToggled = () => {
      if (userProfile) {
        getUserLibraryGames(effectiveSortBy, true, shops);
      }
    };

    window.addEventListener("hydra:game-pin-toggled", handlePinToggled);
    return () => {
      window.removeEventListener("hydra:game-pin-toggled", handlePinToggled);
    };
  }, [getUserLibraryGames, effectiveSortBy, shops, userProfile]);

  // Clear reviews state and reset tab when switching users
  useEffect(() => {
    setReviews([]);
    setReviewsTotalCount(0);
    setIsLoadingReviews(false);
    setActiveTab(requestedTab === "souvenirs" ? "souvenirs" : "library");
    setPlatform(readStoredProfilePlatform());
  }, [requestedTab, userProfile?.id]);

  const fetchUserReviews = useCallback(async () => {
    if (!userProfile?.id) return;

    setIsLoadingReviews(true);
    try {
      const response = await window.electron.hydraApi.get<UserReviewsResponse>(
        `/users/${userProfile.id}/reviews`,
        { needsAuth: false }
      );
      setReviews(response.reviews);
      setReviewsTotalCount(response.totalCount);
    } finally {
      setIsLoadingReviews(false);
    }
  }, [userProfile?.id]);

  useEffect(() => {
    fetchUserReviews();
  }, [fetchUserReviews, userDetails?.id]);

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
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

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

  useEffect(() => {
    const interval = window.setInterval(
      () => setStatsIndex((index) => index + 1),
      GAME_STATS_ANIMATION_DURATION_IN_MS
    );

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const usersAreFriends = useMemo(() => {
    return userProfile?.relation?.status === "ACCEPTED";
  }, [userProfile]);

  const content = (() => {
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
      hasAnyGames || userProfile.friends.length > 0 || isMe;

    return (
      <section className="profile-content__section">
        <div className="profile-content__main">
          <ProfileTabs
            activeTab={activeTab}
            reviewsTotalCount={reviewsTotalCount}
            souvenirsCount={souvenirsTotal}
            onTabChange={setActiveTab}
          />

          <div className="profile-content__tab-panels">
            <AnimatePresence mode="wait">
              {activeTab === "library" && (
                <LibraryTab
                  sortBy={effectiveSortBy}
                  onSortChange={handleSortChange}
                  platform={platform}
                  onPlatformChange={handlePlatformChange}
                  pinnedGames={pinnedGames}
                  libraryGames={libraryGames}
                  hasMoreLibraryGames={hasMoreLibraryGames}
                  isAwaitingInitialLibrary={isCorrectingPrefetchedSort}
                  statsIndex={statsIndex}
                  userStats={userStats}
                  onLoadMore={handleLoadMore}
                  isMe={isMe}
                  hasActiveSubscription={Boolean(
                    userProfile.hasActiveSubscription
                  )}
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

              {activeTab === "souvenirs" && (
                <SouvenirsTab
                  achievements={souvenirs}
                  hasReachedLimit={hasReachedSouvenirLimit}
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

        {shouldShowRightContent && (
          <div className="profile-content__right-content">
            {userStats && (
              <ProfileSection title={t("stats")} defaultOpen={true}>
                <UserStatsBox />
              </ProfileSection>
            )}
            {userProfile?.badges.length > 0 && (
              <ProfileSection
                title={t("badges")}
                count={userProfile.badges.length}
                defaultOpen={true}
              >
                <BadgesBox />
              </ProfileSection>
            )}
            {userProfile?.recentGames.length > 0 && (
              <ProfileSection title={t("activity")} defaultOpen={true}>
                <RecentGamesBox />
              </ProfileSection>
            )}
            {(userProfile?.friends.length > 0 || isMe) && (
              <ProfileSection
                title={t("friends")}
                count={userStats?.friendsCount || userProfile.friends.length}
                action={<FriendsBoxAddButton />}
                defaultOpen={true}
              >
                <FriendsBox />
              </ProfileSection>
            )}
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
  })();

  return (
    <div>
      <ProfileHero />

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
