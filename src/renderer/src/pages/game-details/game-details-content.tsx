import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { PencilIcon, TrashIcon, ClockIcon } from "@primer/octicons-react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { motion } from "framer-motion";
import type { GameReview } from "@types";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";
import { EditGameModal, DeleteReviewModal } from "./modals";
import { ReviewSortOptions } from "./review-sort-options";
import { ReviewPromptBanner } from "./review-prompt-banner";

import { sanitizeHtml, AuthPage } from "@shared";
import { useTranslation } from "react-i18next";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import cloudIconAnimated from "@renderer/assets/icons/cloud-animated.gif";
import { useUserDetails, useLibrary, useDate } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./game-details.scss";

// Helper function to get score color class
const getScoreColorClass = (score: number): string => {
  if (score >= 0 && score <= 3) return "game-details__review-score--red";
  if (score >= 4 && score <= 6) return "game-details__review-score--yellow";
  if (score >= 7 && score <= 10) return "game-details__review-score--green";
  return "";
};

// Helper function to process media elements for responsive display
const processMediaElements = (document: Document) => {
  const $images = Array.from(document.querySelectorAll("img"));
  $images.forEach(($image) => {
    $image.loading = "lazy";
    // Remove any inline width/height styles that might cause overflow
    $image.removeAttribute("width");
    $image.removeAttribute("height");
    $image.removeAttribute("style");
    // Set max-width to prevent overflow
    $image.style.maxWidth = "100%";
    $image.style.width = "auto";
    $image.style.height = "auto";
    $image.style.boxSizing = "border-box";
  });

  // Handle videos the same way
  const $videos = Array.from(document.querySelectorAll("video"));
  $videos.forEach(($video) => {
    // Remove any inline width/height styles that might cause overflow
    $video.removeAttribute("width");
    $video.removeAttribute("height");
    $video.removeAttribute("style");
    // Set max-width to prevent overflow
    $video.style.maxWidth = "100%";
    $video.style.width = "auto";
    $video.style.height = "auto";
    $video.style.boxSizing = "border-box";
  });
};

// Helper function to get score color class for select element
const getSelectScoreColorClass = (score: number): string => {
  if (score >= 0 && score <= 3) return "game-details__review-score-select--red";
  if (score >= 4 && score <= 7)
    return "game-details__review-score-select--yellow";
  if (score >= 8 && score <= 10)
    return "game-details__review-score-select--green";
  return "";
};

export function GameDetailsContent() {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  const { t } = useTranslation("game_details");

  const {
    objectId,
    shopDetails,
    game,
    hasNSFWContentBlocked,
    updateGame,
    shop,
  } = useContext(gameDetailsContext);

  const { showHydraCloudModal } = useSubscription();

  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { updateLibrary } = useLibrary();
  const { formatDistance } = useDate();

  const { setShowCloudSyncModal, getGameArtifacts } =
    useContext(cloudSyncContext);

  const aboutTheGame = useMemo(() => {
    const aboutTheGame = shopDetails?.about_the_game;
    if (aboutTheGame) {
      const document = new DOMParser().parseFromString(
        aboutTheGame,
        "text/html"
      );

      processMediaElements(document);

      return document.body.outerHTML;
    }

    if (game?.shop === "custom") {
      return "";
    }

    return t("no_shop_details");
  }, [shopDetails, t, game?.shop]);

  const [backdropOpacity, setBackdropOpacity] = useState(1);
  const [showEditGameModal, setShowEditGameModal] = useState(false);
  const [showDeleteReviewModal, setShowDeleteReviewModal] = useState(false);
  const [reviewToDelete, setReviewToDelete] = useState<string | null>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  // Reviews state management
  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewScore, setReviewScore] = useState<number | null>(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewCharCount, setReviewCharCount] = useState(0);
  const MAX_REVIEW_CHARS = 1000;
  const [reviewsSortBy, setReviewsSortBy] = useState("newest");
  const [reviewsPage, setReviewsPage] = useState(0);
  const [hasMoreReviews, setHasMoreReviews] = useState(true);
  const [visibleBlockedReviews, setVisibleBlockedReviews] = useState<
    Set<string>
  >(new Set());
  const [totalReviewCount, setTotalReviewCount] = useState(0);
  const [showReviewForm, setShowReviewForm] = useState(false);

  // Review prompt banner state
  const [showReviewPrompt, setShowReviewPrompt] = useState(false);
  const [hasUserReviewed, setHasUserReviewed] = useState(false);
  const [reviewCheckLoading, setReviewCheckLoading] = useState(false);

  // Tiptap editor for review input
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable link extension to prevent automatic link rendering and XSS
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
        // Strip formatting from pasted content to prevent overflow issues
        const text = event.clipboardData?.getData("text/plain") || "";
        const currentText = view.state.doc.textContent;
        const remainingChars = MAX_REVIEW_CHARS - currentText.length;

        if (text && remainingChars > 0) {
          event.preventDefault();
          const truncatedText = text.slice(0, remainingChars);
          view.dispatch(view.state.tr.insertText(truncatedText));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      setReviewCharCount(text.length);

      // Prevent typing beyond character limit
      if (text.length > MAX_REVIEW_CHARS) {
        const truncatedContent = text.slice(0, MAX_REVIEW_CHARS);
        editor.commands.setContent(truncatedContent);
        setReviewCharCount(MAX_REVIEW_CHARS);
      }
    },
  });

  useEffect(() => {
    setBackdropOpacity(1);
  }, [objectId]);

  const handleCloudSaveButtonClick = () => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    if (!hasActiveSubscription) {
      showHydraCloudModal("backup");
      return;
    }

    setShowCloudSyncModal(true);
  };

  const handleEditGameClick = () => {
    setShowEditGameModal(true);
  };

  const handleGameUpdated = (_updatedGame: any) => {
    updateGame();
    updateLibrary();
  };

  useEffect(() => {
    getGameArtifacts();
  }, [getGameArtifacts]);

  const isCustomGame = game?.shop === "custom";

  // Reviews functions
  const checkUserReview = async () => {
    if (!objectId || !userDetails) return;

    setReviewCheckLoading(true);
    try {
      const response = await window.electron.checkGameReview(shop, objectId);
      const hasReviewed = (response as any)?.hasReviewed || false;
      setHasUserReviewed(hasReviewed);

      // Show prompt only if user hasn't reviewed and has played the game
      if (
        !hasReviewed &&
        game?.playTimeInMilliseconds &&
        game.playTimeInMilliseconds > 0
      ) {
        setShowReviewPrompt(true);
      }
    } catch (error) {
      console.error("Failed to check user review:", error);
    } finally {
      setReviewCheckLoading(false);
    }
  };

  const loadReviews = async (reset = false) => {
    if (!objectId) return;

    setReviewsLoading(true);
    try {
      const skip = reset ? 0 : reviewsPage * 20;
      const response = await window.electron.getGameReviews(
        shop,
        objectId,
        20,
        skip,
        reviewsSortBy
      );

      // Handle the response structure: { totalCount: number, reviews: Review[] }
      const reviewsData = (response as any)?.reviews || [];
      const reviewCount = (response as any)?.totalCount || 0;

      if (reset) {
        setReviews(reviewsData);
        setReviewsPage(0);
        setTotalReviewCount(reviewCount);
      } else {
        setReviews((prev) => [...prev, ...reviewsData]);
      }

      setHasMoreReviews(reviewsData.length === 20);
    } catch (error) {
      console.error("Failed to load reviews:", error);
    } finally {
      setReviewsLoading(false);
    }
  };

  const handleVoteReview = async (
    reviewId: string,
    voteType: "upvote" | "downvote"
  ) => {
    if (!objectId) return;

    try {
      await window.electron.voteReview(shop, objectId, reviewId, voteType);
      // Reload reviews to get updated vote counts
      loadReviews(true);
    } catch (error) {
      console.error(`Failed to ${voteType} review:`, error);
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    setReviewToDelete(reviewId);
    setShowDeleteReviewModal(true);
  };

  const confirmDeleteReview = async () => {
    if (!objectId || !reviewToDelete) return;

    try {
      await window.electron.deleteReview(shop, objectId, reviewToDelete);
      // Reload reviews after deletion
      loadReviews(true);
      setShowDeleteReviewModal(false);
      setReviewToDelete(null);
    } catch (error) {
      console.error("Failed to delete review:", error);
    }
  };

  const handleSubmitReview = async () => {
    console.log("handleSubmitReview called");
    console.log("game:", game);
    console.log("objectId:", objectId);

    const reviewHtml = editor?.getHTML() || "";
    console.log("reviewHtml:", reviewHtml);
    console.log("reviewScore:", reviewScore);
    console.log("submittingReview:", submittingReview);

    if (
      !objectId ||
      !reviewHtml.trim() ||
      reviewScore === null ||
      submittingReview ||
      reviewCharCount > MAX_REVIEW_CHARS
    ) {
      console.log("Early return - validation failed");
      return;
    }

    console.log("Starting review submission...");
    setSubmittingReview(true);
    try {
      console.log("Calling window.electron.createGameReview...");
      await window.electron.createGameReview(
        shop,
        objectId,
        reviewHtml,
        reviewScore
      );

      console.log("Review submitted successfully");
      editor?.commands.clearContent();
      setReviewScore(null);
      await loadReviews(true); // Reload reviews after submission
      setShowReviewForm(false); // Hide the review form after successful submission
      setShowReviewPrompt(false); // Hide the prompt banner
      setHasUserReviewed(true); // Update the review status
    } catch (error) {
      console.error("Failed to submit review:", error);
    } finally {
      setSubmittingReview(false);
      console.log("Review submission completed");
    }
  };

  // Review prompt banner handlers
  const handleReviewPromptYes = () => {
    setShowReviewPrompt(false);
    setShowReviewForm(true);

    // Scroll to review form
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
  };

  const handleSortChange = (newSortBy: string) => {
    setReviewsSortBy(newSortBy);
    setReviewsPage(0);
    setHasMoreReviews(true);
    loadReviews(true);
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

  // Load reviews when component mounts or sort changes
  useEffect(() => {
    if (objectId && (game || shop)) {
      loadReviews(true);
      checkUserReview(); // Check if user has reviewed this game
    }
  }, [game, shop, objectId, reviewsSortBy, userDetails]);

  // Load more reviews when page changes
  useEffect(() => {
    if (reviewsPage > 0) {
      loadReviews(false);
    }
  }, [reviewsPage]);

  // Helper function to get image with custom asset priority
  const getImageWithCustomPriority = (
    customUrl: string | null | undefined,
    originalUrl: string | null | undefined,
    fallbackUrl?: string | null | undefined
  ) => {
    return customUrl || originalUrl || fallbackUrl || "";
  };

  const heroImage = isCustomGame
    ? game?.libraryHeroImageUrl || game?.iconUrl || ""
    : getImageWithCustomPriority(
        game?.customHeroImageUrl,
        shopDetails?.assets?.libraryHeroImageUrl
      );

  const logoImage = isCustomGame
    ? game?.logoImageUrl || ""
    : getImageWithCustomPriority(
        game?.customLogoImageUrl,
        shopDetails?.assets?.logoImageUrl
      );

  const renderGameLogo = () => {
    if (isCustomGame) {
      // For custom games, show logo image if available, otherwise show game title as text
      if (logoImage) {
        return (
          <img
            src={logoImage}
            className="game-details__game-logo"
            alt={game?.title}
          />
        );
      } else {
        return (
          <div className="game-details__game-logo-text">{game?.title}</div>
        );
      }
    } else {
      // For non-custom games, show logo image if available
      return logoImage ? (
        <img
          src={logoImage}
          className="game-details__game-logo"
          alt={game?.title}
        />
      ) : null;
    }
  };

  return (
    <div
      className={`game-details__wrapper ${hasNSFWContentBlocked ? "game-details__wrapper--blurred" : ""}`}
    >
      <section className="game-details__container">
        <div ref={heroRef} className="game-details__hero">
          <img
            src={heroImage}
            className="game-details__hero-image"
            alt={game?.title}
          />
          <div
            className="game-details__hero-backdrop"
            style={{
              flex: 1,
            }}
          />

          <div
            className="game-details__hero-logo-backdrop"
            style={{ opacity: backdropOpacity }}
          >
            <div className="game-details__hero-content">
              {renderGameLogo()}

              <div className="game-details__hero-buttons game-details__hero-buttons--right">
                {game && (
                  <button
                    type="button"
                    className="game-details__edit-custom-game-button"
                    onClick={handleEditGameClick}
                    title={t("edit_game_modal_button")}
                  >
                    <PencilIcon size={16} />
                  </button>
                )}

                {game?.shop !== "custom" && (
                  <button
                    type="button"
                    className="game-details__cloud-sync-button"
                    onClick={handleCloudSaveButtonClick}
                  >
                    <div className="game-details__cloud-icon-container">
                      <img
                        src={cloudIconAnimated}
                        alt="Cloud icon"
                        className="game-details__cloud-icon"
                      />
                    </div>
                    {t("cloud_save")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <HeroPanel />

        <div className="game-details__description-container">
          <div className="game-details__description-content">
            {/* Review Prompt Banner */}
            {game?.shop !== "custom" &&
              showReviewPrompt &&
              userDetails &&
              game?.playTimeInMilliseconds &&
              !hasUserReviewed &&
              !reviewCheckLoading && (
                <ReviewPromptBanner
                  onYesClick={handleReviewPromptYes}
                  onLaterClick={handleReviewPromptLater}
                />
              )}

            <DescriptionHeader />
            <GallerySlider />

            <div
              dangerouslySetInnerHTML={{
                __html: aboutTheGame,
              }}
              className={`game-details__description ${
                isDescriptionExpanded
                  ? "game-details__description--expanded"
                  : "game-details__description--collapsed"
              }`}
            />

            {aboutTheGame && aboutTheGame.length > 500 && (
              <button
                type="button"
                className="game-details__description-toggle"
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
              >
                {isDescriptionExpanded ? t("show_less") : t("show_more")}
              </button>
            )}

            {game?.shop !== "custom" && (
              <div className="game-details__reviews-section">
                {showReviewForm && (
                  <>
                    <div className="game-details__reviews-header">
                      <h3 className="game-details__reviews-title">
                        {t("leave_a_review")}
                      </h3>
                    </div>

                    <div className="game-details__review-form">
                      <div className="game-details__review-input-container">
                        <div className="game-details__review-input-header">
                          <div className="game-details__review-editor-toolbar">
                            <button
                              type="button"
                              onClick={() =>
                                editor?.chain().focus().toggleBold().run()
                              }
                              className={`game-details__editor-button ${editor?.isActive("bold") ? "is-active" : ""}`}
                              disabled={!editor}
                            >
                              <strong>B</strong>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                editor?.chain().focus().toggleItalic().run()
                              }
                              className={`game-details__editor-button ${editor?.isActive("italic") ? "is-active" : ""}`}
                              disabled={!editor}
                            >
                              <em>I</em>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                editor?.chain().focus().toggleUnderline().run()
                              }
                              className={`game-details__editor-button ${editor?.isActive("underline") ? "is-active" : ""}`}
                              disabled={!editor}
                            >
                              <u>U</u>
                            </button>
                          </div>
                          <div className="game-details__review-char-counter">
                            <span
                              className={
                                reviewCharCount > MAX_REVIEW_CHARS
                                  ? "over-limit"
                                  : ""
                              }
                            >
                              {reviewCharCount}/{MAX_REVIEW_CHARS}
                            </span>
                          </div>
                        </div>
                        <div className="game-details__review-input">
                          <EditorContent editor={editor} />
                        </div>
                      </div>

                      <div className="game-details__review-form-bottom">
                        <div className="game-details__review-score-container">
                          <label className="game-details__review-score-label">
                            {t("rating")}
                          </label>
                          <select
                            className={`game-details__review-score-select ${
                              reviewScore
                                ? getSelectScoreColorClass(reviewScore)
                                : ""
                            }`}
                            value={reviewScore || ""}
                            onChange={(e) =>
                              setReviewScore(
                                e.target.value ? Number(e.target.value) : null
                              )
                            }
                          >
                            <option value="" disabled>
                              {t("select_rating")}
                            </option>
                            <option value={1}>1/10</option>
                            <option value={2}>2/10</option>
                            <option value={3}>3/10</option>
                            <option value={4}>4/10</option>
                            <option value={5}>5/10</option>
                            <option value={6}>6/10</option>
                            <option value={7}>7/10</option>
                            <option value={8}>8/10</option>
                            <option value={9}>9/10</option>
                            <option value={10}>10/10</option>
                          </select>
                        </div>

                        <button
                          className="game-details__review-submit-button"
                          onClick={handleSubmitReview}
                          disabled={
                            !editor?.getHTML().trim() ||
                            reviewScore === null ||
                            submittingReview ||
                            reviewCharCount > MAX_REVIEW_CHARS
                          }
                        >
                          {submittingReview
                            ? t("submitting")
                            : t("submit_review")}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {showReviewForm && (
                  <div className="game-details__reviews-separator"></div>
                )}

                <div className="game-details__reviews-list">
                  <div className="game-details__reviews-list-header">
                    <div className="game-details__reviews-title-group">
                      <h3 className="game-details__reviews-title">
                        {t("reviews")}
                      </h3>
                      <span className="game-details__reviews-badge">
                        {totalReviewCount}
                      </span>
                    </div>
                  </div>
                  <ReviewSortOptions
                    sortBy={reviewsSortBy as any}
                    onSortChange={handleSortChange}
                  />

                  {reviewsLoading && reviews.length === 0 && (
                    <div className="game-details__reviews-loading">
                      {t("loading_reviews")}
                    </div>
                  )}

                  {!reviewsLoading && reviews.length === 0 && (
                    <div className="game-details__reviews-empty">
                      <div className="game-details__reviews-empty-icon">📝</div>
                      <h4 className="game-details__reviews-empty-title">
                        {t("no_reviews_yet")}
                      </h4>
                      <p className="game-details__reviews-empty-message">
                        {t("be_first_to_review")}
                      </p>
                    </div>
                  )}

                  {reviews.map((review) => (
                    <div key={review.id} className="game-details__review-item">
                      {review.isBlocked &&
                      !visibleBlockedReviews.has(review.id) ? (
                        <div className="game-details__blocked-review-simple">
                          Review from blocked user —{" "}
                          <button
                            className="game-details__blocked-review-show-link"
                            onClick={() => toggleBlockedReview(review.id)}
                          >
                            Show
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="game-details__review-header">
                            <div className="game-details__review-user">
                              {review.user?.profileImageUrl && (
                                <img
                                  src={review.user.profileImageUrl}
                                  alt={review.user.displayName || "User"}
                                  className="game-details__review-avatar"
                                />
                              )}
                              <div className="game-details__review-user-info">
                                <button
                                  className="game-details__review-display-name game-details__review-display-name--clickable"
                                  onClick={() =>
                                    review.user?.id &&
                                    navigate(`/profile/${review.user.id}`)
                                  }
                                >
                                  {review.user?.displayName || "Anonymous"}
                                </button>
                                <div className="game-details__review-date">
                                  <ClockIcon size={12} />
                                  {formatDistance(
                                    new Date(review.createdAt),
                                    new Date(),
                                    { addSuffix: true }
                                  )}
                                </div>
                              </div>
                            </div>
                            <div
                              className={`game-details__review-score ${getScoreColorClass(review.score)}`}
                            >
                              {review.score}/10
                            </div>
                          </div>
                          <div
                            className="game-details__review-content"
                            dangerouslySetInnerHTML={{
                              __html: sanitizeHtml(review.reviewHtml),
                            }}
                          />
                          <div className="game-details__review-actions">
                            <div className="game-details__review-votes">
                              <motion.button
                                className={`game-details__vote-button game-details__vote-button--upvote ${review.hasUpvoted ? "game-details__vote-button--active" : ""}`}
                                onClick={() =>
                                  handleVoteReview(review.id, "upvote")
                                }
                                whileTap={{
                                  scale: 0.9,
                                  transition: { duration: 0.1 },
                                }}
                                whileHover={{
                                  scale: 1.05,
                                  transition: { duration: 0.2 },
                                }}
                                animate={
                                  review.hasUpvoted
                                    ? {
                                        scale: [1, 1.2, 1],
                                        transition: { duration: 0.3 },
                                      }
                                    : {}
                                }
                              >
                                <ThumbsUp size={16} />
                                <span>{review.upvotes || 0}</span>
                              </motion.button>
                              <motion.button
                                className={`game-details__vote-button game-details__vote-button--downvote ${review.hasDownvoted ? "game-details__vote-button--active" : ""}`}
                                onClick={() =>
                                  handleVoteReview(review.id, "downvote")
                                }
                                whileTap={{
                                  scale: 0.9,
                                  transition: { duration: 0.1 },
                                }}
                                whileHover={{
                                  scale: 1.05,
                                  transition: { duration: 0.2 },
                                }}
                                animate={
                                  review.hasDownvoted
                                    ? {
                                        scale: [1, 1.2, 1],
                                        transition: { duration: 0.3 },
                                      }
                                    : {}
                                }
                              >
                                <ThumbsDown size={16} />
                                <span>{review.downvotes || 0}</span>
                              </motion.button>
                            </div>
                            {userDetails?.id === review.user?.id && (
                              <button
                                className="game-details__delete-review-button"
                                onClick={() => handleDeleteReview(review.id)}
                                title={t("delete_review")}
                              >
                                <TrashIcon size={16} />
                              </button>
                            )}
                            {review.isBlocked &&
                              visibleBlockedReviews.has(review.id) && (
                                <button
                                  className="game-details__blocked-review-hide-link"
                                  onClick={() => toggleBlockedReview(review.id)}
                                >
                                  Hide
                                </button>
                              )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}

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
              </div>
            )}
          </div>

          {game?.shop !== "custom" && <Sidebar />}
        </div>
      </section>

      {game && (
        <EditGameModal
          visible={showEditGameModal}
          onClose={() => setShowEditGameModal(false)}
          game={game}
          shopDetails={shopDetails}
          onGameUpdated={handleGameUpdated}
        />
      )}

      <DeleteReviewModal
        visible={showDeleteReviewModal}
        onClose={() => {
          setShowDeleteReviewModal(false);
          setReviewToDelete(null);
        }}
        onConfirm={confirmDeleteReview}
      />
    </div>
  );
}
