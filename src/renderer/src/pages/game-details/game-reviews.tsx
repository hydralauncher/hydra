import { useCallback, useEffect, useRef, useState } from "react";
import { NoteIcon } from "@primer/octicons-react";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslation } from "react-i18next";
import type { GameReview, Game, GameShop } from "@types";

import { ReviewForm } from "./review-form";
import { ReviewItem } from "./review-item";
import { ReviewSortOptions } from "./review-sort-options";
import { ReviewPromptBanner } from "./review-prompt-banner";
import { useToast } from "@renderer/hooks";

type ReviewSortOption =
  | "newest"
  | "oldest"
  | "score_high"
  | "score_low"
  | "most_voted";

interface GameReviewsProps {
  shop: GameShop;
  objectId: string;
  game: Game | null;
  userDetailsId?: string;
  isGameInLibrary: boolean;
  hasUserReviewed: boolean;
  onUserReviewedChange: (hasReviewed: boolean) => void;
}

const MAX_REVIEW_CHARS = 1000;

export function GameReviews({
  shop,
  objectId,
  game,
  userDetailsId,
  isGameInLibrary,
  hasUserReviewed,
  onUserReviewedChange,
}: Readonly<GameReviewsProps>) {
  const { t, i18n } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();

  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewCharCount, setReviewCharCount] = useState(0);
  const [reviewsSortBy, setReviewsSortBy] =
    useState<ReviewSortOption>("newest");
  const [reviewsPage, setReviewsPage] = useState(0);
  const [hasMoreReviews, setHasMoreReviews] = useState(true);
  const [visibleBlockedReviews, setVisibleBlockedReviews] = useState<
    Set<string>
  >(new Set());
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [votingReviews, setVotingReviews] = useState<Set<string>>(new Set());
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);

  const previousVotesRef = useRef<
    Map<string, { upvotes: number; downvotes: number }>
  >(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "game-details__review-editor",
        "data-placeholder": t("write_review_placeholder"),
      },
      handlePaste: (view, event) => {
        const htmlContent = event.clipboardData?.getData("text/html") || "";
        const plainText = event.clipboardData?.getData("text/plain") || "";

        const currentText = view.state.doc.textContent;
        const remainingChars = MAX_REVIEW_CHARS - currentText.length;

        if ((htmlContent || plainText) && remainingChars > 0) {
          event.preventDefault();

          if (htmlContent) {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = htmlContent;
            const textLength = tempDiv.textContent?.length || 0;

            if (textLength <= remainingChars) {
              return false;
            }
          }

          const truncatedText = plainText.slice(0, remainingChars);
          view.dispatch(view.state.tr.insertText(truncatedText));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      setReviewCharCount(text.length);

      if (text.length > MAX_REVIEW_CHARS) {
        const truncatedContent = text.slice(0, MAX_REVIEW_CHARS);
        editor.commands.setContent(truncatedContent);
        setReviewCharCount(MAX_REVIEW_CHARS);
      }
    },
  });

  const checkUserReview = useCallback(async () => {
    if (!objectId || !userDetailsId) return;

    try {
      const response = await window.electron.hydraApi.get<{
        hasReviewed: boolean;
      }>(`/games/${shop}/${objectId}/reviews/check`, {
        needsAuth: true,
      });
      const hasReviewed = response?.hasReviewed || false;
      onUserReviewedChange(hasReviewed);

      const twoHoursInMilliseconds = 2 * 60 * 60 * 1000;
      const hasEnoughPlaytime =
        game && game.playTimeInMilliseconds >= twoHoursInMilliseconds;

      if (
        !hasReviewed &&
        hasEnoughPlaytime &&
        !sessionStorage.getItem(`reviewPromptDismissed_${objectId}`)
      ) {
        setShowReviewPrompt(true);
        setShowReviewForm(true);
      }
    } catch (error) {
      console.error("Failed to check user review:", error);
    }
  }, [objectId, userDetailsId, shop, game, onUserReviewedChange]);

  console.log("reviews", reviews);

  const loadReviews = useCallback(
    async (reset = false) => {
      if (!objectId) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setReviewsLoading(true);
      try {
        const skip = reset ? 0 : reviewsPage * 20;
        const params = new URLSearchParams({
          take: "20",
          skip: skip.toString(),
          sortBy: reviewsSortBy,
          language: i18n.language,
        });

        const response = await window.electron.hydraApi.get(
          `/games/${shop}/${objectId}/reviews?${params.toString()}`,
          { needsAuth: false }
        );

        if (abortController.signal.aborted) {
          return;
        }

        const typedResponse = response as unknown as
          | { reviews: GameReview[]; totalCount: number }
          | undefined;
        const reviewsData = typedResponse?.reviews || [];
        const reviewCount = typedResponse?.totalCount || 0;

        if (reset) {
          setReviews(reviewsData);
          setReviewsPage(0);
          setTotalReviewCount(reviewCount);
        } else {
          setReviews((prev) => [...prev, ...reviewsData]);
        }

        setHasMoreReviews(reviewsData.length === 20);
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error("Failed to load reviews:", error);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setReviewsLoading(false);
        }
      }
    },
    [objectId, shop, reviewsPage, reviewsSortBy, i18n.language]
  );

  const handleVoteReview = async (
    reviewId: string,
    voteType: "upvote" | "downvote"
  ) => {
    if (!objectId || votingReviews.has(reviewId)) return;

    setVotingReviews((prev) => new Set(prev).add(reviewId));

    const reviewIndex = reviews.findIndex((r) => r.id === reviewId);
    if (reviewIndex === -1) {
      setVotingReviews((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
      return;
    }

    const review = reviews[reviewIndex];
    const originalReview = { ...review };

    const updatedReviews = [...reviews];
    const updatedReview = { ...review };

    if (voteType === "upvote") {
      if (review.hasUpvoted) {
        updatedReview.hasUpvoted = false;
        updatedReview.upvotes = Math.max(0, (review.upvotes || 0) - 1);
      } else {
        updatedReview.hasUpvoted = true;
        updatedReview.upvotes = (review.upvotes || 0) + 1;

        if (review.hasDownvoted) {
          updatedReview.hasDownvoted = false;
          updatedReview.downvotes = Math.max(0, (review.downvotes || 0) - 1);
        }
      }
    } else {
      if (review.hasDownvoted) {
        updatedReview.hasDownvoted = false;
        updatedReview.downvotes = Math.max(0, (review.downvotes || 0) - 1);
      } else {
        updatedReview.hasDownvoted = true;
        updatedReview.downvotes = (review.downvotes || 0) + 1;

        if (review.hasUpvoted) {
          updatedReview.hasUpvoted = false;
          updatedReview.upvotes = Math.max(0, (review.upvotes || 0) - 1);
        }
      }
    }

    updatedReviews[reviewIndex] = updatedReview;
    setReviews(updatedReviews);

    try {
      await window.electron.hydraApi.put(
        `/games/${shop}/${objectId}/reviews/${reviewId}/${voteType}`,
        { data: {} }
      );
    } catch (error) {
      console.error(`Failed to ${voteType} review:`, error);

      const rolledBackReviews = [...reviews];
      rolledBackReviews[reviewIndex] = originalReview;
      setReviews(rolledBackReviews);

      showErrorToast(t("vote_failed"));
    } finally {
      setTimeout(() => {
        setVotingReviews((prev) => {
          const next = new Set(prev);
          next.delete(reviewId);
          return next;
        });
      }, 500);
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!objectId) return;

    try {
      await window.electron.hydraApi.delete(
        `/games/${shop}/${objectId}/reviews/${reviewId}`
      );
      loadReviews(true);
      onUserReviewedChange(false);
      setShowReviewForm(true);
      showSuccessToast(t("review_deleted_successfully"));
    } catch (error) {
      console.error("Failed to delete review:", error);
      showErrorToast(t("review_deletion_failed"));
    }
  };

  const handleSubmitReview = async () => {
    const reviewHtml = editor?.getHTML() || "";
    const reviewText = editor?.getText() || "";

    if (!objectId) return;

    if (!reviewText.trim()) {
      showErrorToast(t("review_cannot_be_empty"));
      return;
    }

    if (submittingReview || reviewCharCount > MAX_REVIEW_CHARS) {
      return;
    }

    if (reviewScore === null) {
      return;
    }

    setSubmittingReview(true);

    try {
      await window.electron.hydraApi.post(
        `/games/${shop}/${objectId}/reviews`,
        {
          data: {
            reviewHtml,
            score: reviewScore,
          },
        }
      );

      editor?.commands.clearContent();
      setReviewScore(null);
      showSuccessToast(t("review_submitted_successfully"));

      await loadReviews(true);
      setShowReviewForm(false);
      setShowReviewPrompt(false);
      onUserReviewedChange(true);
    } catch (error) {
      console.error("Failed to submit review:", error);
      showErrorToast(t("review_submission_failed"));
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleReviewPromptYes = () => {
    setShowReviewPrompt(false);

    setTimeout(() => {
      const reviewFormElement = document.querySelector(
        ".game-details__review-form"
      );
      if (reviewFormElement) {
        reviewFormElement.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 100);
  };

  const handleReviewPromptLater = () => {
    setShowReviewPrompt(false);
    setShowReviewForm(false);
    if (objectId) {
      sessionStorage.setItem(`reviewPromptDismissed_${objectId}`, "true");
    }
  };

  const handleSortChange = (newSortBy: ReviewSortOption) => {
    if (newSortBy !== reviewsSortBy) {
      setReviewsSortBy(newSortBy);
      setReviewsPage(0);
      setHasMoreReviews(true);
      loadReviews(true);
    }
  };

  const toggleBlockedReview = (reviewId: string) => {
    setVisibleBlockedReviews((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(reviewId)) {
        newSet.delete(reviewId);
      } else {
        newSet.add(reviewId);
      }
      return newSet;
    });
  };

  const loadMoreReviews = () => {
    if (!reviewsLoading && hasMoreReviews) {
      setReviewsPage((prev) => prev + 1);
      loadReviews(false);
    }
  };

  const handleVoteAnimationComplete = (
    reviewId: string,
    votes: { upvotes: number; downvotes: number }
  ) => {
    previousVotesRef.current.set(reviewId, votes);
  };

  useEffect(() => {
    if (objectId) {
      loadReviews(true);
      if (userDetailsId) {
        checkUserReview();
      }
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [objectId, userDetailsId, checkUserReview, loadReviews]);

  useEffect(() => {
    if (reviewsPage > 0) {
      loadReviews(false);
    }
  }, [reviewsPage, loadReviews]);

  useEffect(() => {
    reviews.forEach((review) => {
      if (!previousVotesRef.current.has(review.id)) {
        previousVotesRef.current.set(review.id, {
          upvotes: review.upvotes || 0,
          downvotes: review.downvotes || 0,
        });
      }
    });
  }, [reviews]);

  console.log("reviews", reviews);

  return (
    <div className="game-details__reviews-section">
      {showReviewPrompt &&
        userDetailsId &&
        !hasUserReviewed &&
        isGameInLibrary && (
          <ReviewPromptBanner
            onYesClick={handleReviewPromptYes}
            onLaterClick={handleReviewPromptLater}
          />
        )}

      {showReviewForm && (
        <>
          <ReviewForm
            editor={editor}
            reviewScore={reviewScore}
            reviewCharCount={reviewCharCount}
            maxReviewChars={MAX_REVIEW_CHARS}
            submittingReview={submittingReview}
            onScoreChange={setReviewScore}
            onSubmit={handleSubmitReview}
          />
          <div className="game-details__reviews-separator"></div>
        </>
      )}

      <div className="game-details__reviews-list-header">
        <div className="game-details__reviews-title-group">
          <h3 className="game-details__reviews-title">{t("reviews")}</h3>
          <span className="game-details__reviews-badge">
            {totalReviewCount}
          </span>
        </div>
      </div>
      <ReviewSortOptions
        sortBy={reviewsSortBy}
        onSortChange={handleSortChange}
      />

      {reviewsLoading && reviews.length === 0 && (
        <div className="game-details__reviews-loading">
          {t("loading_reviews")}
        </div>
      )}

      {!reviewsLoading && reviews.length === 0 && (
        <div className="game-details__reviews-empty">
          <div className="game-details__reviews-empty-icon">
            <NoteIcon size={48} />
          </div>
          <h4 className="game-details__reviews-empty-title">
            {t("no_reviews_yet")}
          </h4>
          <p className="game-details__reviews-empty-message">
            {t("be_first_to_review")}
          </p>
        </div>
      )}

      <div
        className="game-details__reviews-container"
        style={{
          opacity: reviewsLoading && reviews.length > 0 ? 0.5 : 1,
          transition: "opacity 0.2s ease",
        }}
      >
        {reviews.map((review) => (
          <ReviewItem
            key={review.id}
            review={review}
            userDetailsId={userDetailsId}
            isBlocked={review.isBlocked}
            isVisible={visibleBlockedReviews.has(review.id)}
            isVoting={votingReviews.has(review.id)}
            previousVotes={
              previousVotesRef.current.get(review.id) || {
                upvotes: 0,
                downvotes: 0,
              }
            }
            onVote={handleVoteReview}
            onDelete={handleDeleteReview}
            onToggleVisibility={toggleBlockedReview}
            onAnimationComplete={handleVoteAnimationComplete}
          />
        ))}
      </div>

      {hasMoreReviews && !reviewsLoading && (
        <button
          className="game-details__load-more-reviews"
          onClick={loadMoreReviews}
        >
          {t("load_more_reviews")}
        </button>
      )}

      {reviewsLoading && reviews.length > 0 && (
        <div className="game-details__reviews-loading">
          {t("loading_more_reviews")}
        </div>
      )}
    </div>
  );
}
